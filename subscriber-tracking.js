import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { tenantCollection, tenantDoc } from "./lib/subscriber-paths.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";

const state = {
  subscriberId: null,
  viewerProfile: null,
  viewerRole: null,
  subscriberProfile: null,
  repDirectory: [],
  repNameCache: new Map(),
  repMarkers: new Map(),
  unsubscribeLocations: null,
  unsubscribeShifts: null,
  map: null,
  markerCluster: null,
  rawDoors: [],
  filteredDoors: [],
  shifts: [],
  filters: {
    rep: "all",
    start: isoToday(),
    end: isoToday(),
  },
  modalShift: null,
  modalLogs: [],
};

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  trackingContent: document.getElementById("trackingContent"),
  filterRep: document.getElementById("filterRep"),
  quickRange: document.getElementById("quickDateRange"),
  startDate: document.getElementById("filterDateStart"),
  endDate: document.getElementById("filterDateEnd"),
  applyFilters: document.getElementById("applyFilters"),
  exportCsv: document.getElementById("exportCsv"),
  refreshHistory: document.getElementById("refreshHistory"),
  filtersHint: document.getElementById("filtersHint"),
  shiftHistory: document.getElementById("shiftHistory"),
  statDoors: document.getElementById("statDoors"),
  statX: document.getElementById("statX"),
  statO: document.getElementById("statO"),
  statSales: document.getElementById("statSales"),
  statConversion: document.getElementById("statConversion"),
  statMiles: document.getElementById("statMiles"),
  statDph: document.getElementById("statDph"),
  mapOverlay: document.getElementById("mapOverlay"),
  logoutBtn: document.getElementById("logoutBtn"),
  statusIndicator: document.getElementById("statusIndicator"),
  companyNameDisplay: document.getElementById("companyNameDisplay"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  shiftSummaryModal: document.getElementById("shiftSummaryModal"),
  shiftSummaryBody: document.getElementById("shiftSummaryBody"),
  highlightShiftBtn: document.getElementById("highlightShiftBtn"),
  downloadShiftBtn: document.getElementById("downloadShiftBtn"),
  closeShiftSummary: document.getElementById("closeShiftSummary"),
};

initUi();
startAuth();
window._subscriberTrackingState = state;

function initUi() {
  const today = isoToday();
  elements.startDate.value = today;
  elements.endDate.value = today;
  elements.quickRange.value = "today";

  elements.quickRange.addEventListener("change", () => {
    applyQuickRange(elements.quickRange.value);
  });

  elements.applyFilters.addEventListener("click", () => {
    handleApplyFilters();
  });

  elements.exportCsv.addEventListener("click", () => {
    exportDoorsCsv();
  });

  elements.refreshHistory.addEventListener("click", () => {
    renderShiftHistory();
  });

  elements.logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "./subscriber-login.html";
    } catch (err) {
      console.warn("Sign out failed", err);
    }
  });

  if (elements.menuBtn) {
    elements.menuBtn.addEventListener("click", () => {
      window.location.href = "/main.html";
    });
  }

  elements.closeShiftSummary.addEventListener("click", () => {
    state.modalShift = null;
    state.modalLogs = [];
    elements.shiftSummaryModal.close();
    elements.filtersHint.textContent = "Tip: pick a rep to focus the stats and map markers.";
    renderDoorPins();
  });

  elements.highlightShiftBtn.addEventListener("click", () => {
    if (state.modalLogs.length) {
      highlightShiftOnMap(state.modalShift, state.modalLogs);
      elements.shiftSummaryModal.close();
      elements.filtersHint.textContent = "Showing the selected shift route. Click Apply to return to range pins.";
    }
  });

  elements.downloadShiftBtn.addEventListener("click", () => {
    if (state.modalShift && state.modalLogs.length) {
      downloadShiftLogs(state.modalShift, state.modalLogs);
    }
  });
}

function startAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./subscriber-login.html";
      return;
    }

    try {
      await bootstrapSubscriber(user);
    } catch (err) {
      console.error("Subscriber tracking init failed", err);
      alert(err.message || "Unable to load tracking dashboard");
      try {
        await signOut(auth);
      } catch (_) {}
      window.location.href = "./subscriber-login.html";
    }
  });
}

async function bootstrapSubscriber(user) {
  const access = await ensureSubscriberAccess(user);
  state.subscriberId = access.subscriberId;
  state.viewerProfile = access.viewerProfile;
  state.viewerRole = access.viewerRole;
  state.subscriberProfile = access.subscriberProfile;

  if (access.viewerRole === "subscriber" && !access.viewerProfile.billingCompleted) {
    window.location.href = "./subscriber-billing.html";
    return;
  }

  const displayName = access.subscriberProfile?.companyName || access.subscriberProfile?.name;
  if (displayName && elements.companyNameDisplay) {
    elements.companyNameDisplay.textContent = displayName;
    elements.companyNameDisplay.style.display = "inline-flex";
  }

  hideOverlay();
  initMap();

  await loadRepDirectory();
  subscribeToLiveLocations();
  subscribeToShifts();
  await loadDoorPins();
  renderShiftHistory();
}

function hideOverlay() {
  if (elements.authOverlay) {
    elements.authOverlay.style.display = "none";
  }
  if (elements.trackingContent) {
    elements.trackingContent.style.display = "block";
  }
}

function initMap() {
  if (state.map) return;
  state.map = L.map("subscriberMap", {
    preferCanvas: true,
    zoomControl: true,
  }).setView([54.6, -2.9], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);

  state.markerCluster = L.markerClusterGroup({
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
  });
  state.map.addLayer(state.markerCluster);
}

async function loadRepDirectory() {
  try {
    const usersSnap = await getDocs(
      query(collection(db, "users"), where("subscriberId", "==", state.subscriberId))
    );
    state.repDirectory = [];
    state.repNameCache.clear();
    const seen = new Set();

    usersSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const role = (data.role || "").toLowerCase();
      const displayName = data.name || data.repName || data.email || docSnap.id;
      state.repNameCache.set(docSnap.id, displayName);
      if (role === "rep" && !seen.has(docSnap.id)) {
        state.repDirectory.push({ id: docSnap.id, name: displayName });
        seen.add(docSnap.id);
      }
    });

    state.repDirectory.sort((a, b) => a.name.localeCompare(b.name));
    populateRepSelect();
  } catch (err) {
    console.warn("Failed to load rep directory", err);
  }
}

function populateRepSelect() {
  if (!elements.filterRep) return;
  const current = elements.filterRep.value || "all";
  elements.filterRep.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All reps";
  elements.filterRep.appendChild(allOption);

  state.repDirectory.forEach((rep) => {
    const opt = document.createElement("option");
    opt.value = rep.id;
    opt.textContent = rep.name;
    elements.filterRep.appendChild(opt);
  });
  elements.filterRep.value = current;
  elements.filterRep.onchange = () => {
    state.filters.rep = elements.filterRep.value;
    updateLiveMarkerVisibility();
    renderDoorPins();
    renderShiftHistory();
  };
}

function applyQuickRange(range) {
  const today = isoToday();
  let start = today;
  let end = today;

  if (range === "yesterday") {
    start = isoDaysAgo(1);
    end = start;
  } else if (range === "last7") {
    start = isoDaysAgo(6);
    end = today;
  } else if (range === "last30") {
    start = isoDaysAgo(29);
    end = today;
  } else if (range === "custom") {
    elements.startDate.removeAttribute("disabled");
    elements.endDate.removeAttribute("disabled");
    return;
  }

  elements.startDate.value = start;
  elements.endDate.value = end;
  elements.startDate.setAttribute("disabled", "true");
  elements.endDate.setAttribute("disabled", "true");
  state.filters.start = start;
  state.filters.end = end;
}

async function handleApplyFilters() {
  const start = elements.startDate.value;
  const end = elements.endDate.value || start;
  if (!start) {
    alert("Pick a start date");
    return;
  }
  if (end && end < start) {
    alert("End date cannot be before start date");
    return;
  }

  state.filters.rep = elements.filterRep.value || "all";
  state.filters.start = start;
  state.filters.end = end;
  elements.filtersHint.textContent = "Tip: pick a rep to focus the stats and map markers.";

  await loadDoorPins();
  renderShiftHistory();
  updateLiveMarkerVisibility();
}

function subscribeToLiveLocations() {
  if (state.unsubscribeLocations) state.unsubscribeLocations();
  const locRef = tenantCollection(db, state.subscriberId, "repLocations");
  const FRESH_MS = 5 * 60 * 1000;

  state.unsubscribeLocations = onSnapshot(locRef, async (snap) => {
    const now = Date.now();
    const updatedIds = new Set();

    const changes = snap.docChanges();
    for (const change of changes) {
      const data = change.doc.data();
      const repId = data.repId || change.doc.id;
      const ts = data.timestamp ? Date.parse(data.timestamp) : Date.now();
      const isFresh = Number.isFinite(ts) && now - ts <= FRESH_MS && data.active !== false;
      const existing = state.repMarkers.get(repId);

      if (!isFresh) {
        if (existing) {
          state.map.removeLayer(existing);
          state.repMarkers.delete(repId);
        }
        continue;
      }

      const repName = await getRepName(repId);
      const icon = buildLiveIcon(repName);

      if (existing) {
        existing.setLatLng([data.gpsLat, data.gpsLng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([data.gpsLat, data.gpsLng], { icon, opacity: 1, riseOnHover: true });
        marker.bindPopup(`<strong>${escapeHtml(repName)}</strong><br>${new Date(ts).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
        marker.addTo(state.map);
        state.repMarkers.set(repId, marker);
      }

      updatedIds.add(repId);
    }

    // Remove stale markers not present in snapshot.
    for (const [repId, marker] of Array.from(state.repMarkers.entries())) {
      if (!updatedIds.has(repId)) {
        state.map.removeLayer(marker);
        state.repMarkers.delete(repId);
      }
    }

    updateLiveMarkerVisibility();
    updateStatusIndicator();
    updateMapOverlay();
  }, (err) => {
    console.warn("repLocations snapshot failed", err);
  });
}

function buildLiveIcon(repName) {
  return L.divIcon({
    className: "rep-live-marker",
    html: `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:#fff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;color:#0f172a;white-space:nowrap;
      box-shadow:0 6px 18px rgba(15,23,42,0.25);margin-bottom:4px;border:2px solid #34d399;">${escapeHtml(repName)} • <span style="color:#16a34a;">Live</span></div>
      <div style="width:20px;height:20px;background:#16a34a;border-radius:50%;border:3px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,0.45);"></div>
    </div>`,
    iconSize: [24, 36],
    iconAnchor: [12, 32],
  });
}

function updateLiveMarkerVisibility() {
  const filter = state.filters.rep;
  state.repMarkers.forEach((marker, repId) => {
    const visible = filter === "all" || repId === filter;
    marker.setOpacity(visible ? 1 : 0.25);
  });
}

function updateStatusIndicator() {
  if (!elements.statusIndicator) return;
  const liveCount = state.repMarkers.size;
  if (!liveCount) {
    elements.statusIndicator.textContent = "No reps live";
    elements.statusIndicator.style.backgroundColor = "#fee2e2";
    elements.statusIndicator.style.color = "#b91c1c";
    elements.statusIndicator.style.display = "inline-flex";
    return;
  }
  const label = liveCount === 1 ? "1 rep live" : `${liveCount} reps live`;
  elements.statusIndicator.textContent = label;
  elements.statusIndicator.style.backgroundColor = "#dcfce7";
  elements.statusIndicator.style.color = "#166534";
  elements.statusIndicator.style.display = "inline-flex";
}

function setOverlayMessage(message, force) {
  if (!elements.mapOverlay) return;
  if (force) {
    elements.mapOverlay.dataset.force = "true";
    elements.mapOverlay.classList.remove("hidden");
    elements.mapOverlay.textContent = message || "";
    return;
  }
  if (force === false) {
    delete elements.mapOverlay.dataset.force;
    elements.mapOverlay.textContent = "No live reps or doors in the selected range yet.";
    updateMapOverlay();
    return;
  }
}

function updateMapOverlay() {
  if (!elements.mapOverlay) return;
  if (elements.mapOverlay.dataset.force === "true") return;
  const hasDoors = state.filteredDoors.length > 0;
  const hasLive = state.repMarkers.size > 0;
  if (!hasDoors && !hasLive) {
    elements.mapOverlay.classList.remove("hidden");
  } else {
    elements.mapOverlay.classList.add("hidden");
  }
}

async function loadDoorPins() {
  if (!state.subscriberId) return;
  setOverlayMessage("Loading door activity…", true);
  try {
    const constraints = [];
    const doorRef = tenantCollection(db, state.subscriberId, "doorsknocked");
    if (state.filters.start) constraints.push(where("date", ">=", state.filters.start));
    if (state.filters.end) constraints.push(where("date", "<=", state.filters.end));
    constraints.push(orderBy("date"));
    const q = query(doorRef, ...constraints, limit(2000));
    const snap = await getDocs(q);
    state.rawDoors = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => typeof d.gpsLat === "number" && typeof d.gpsLng === "number");
  } catch (err) {
    console.warn("Failed to load doorsknocked", err);
    state.rawDoors = [];
  } finally {
    setOverlayMessage(null, false);
    renderDoorPins();
  }
}

function renderDoorPins() {
  if (!state.markerCluster) return;
  state.markerCluster.clearLayers();

  const repFilter = state.filters.rep;
  state.filteredDoors = state.rawDoors.filter((door) => repFilter === "all" || door.repId === repFilter);

  const markers = state.filteredDoors.map((door) => {
    const color = door.status === "X" ? "#ef4444" : door.status === "O" ? "#f97316" : door.status === "SignUp" ? "#22c55e" : "#38bdf8";
    const icon = L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;"></div>`,
      className: "door-marker",
    });
    const marker = L.marker([door.gpsLat, door.gpsLng], { icon });
    const timeLine = door.timestamp ? new Date(door.timestamp).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }) : door.date;
    const addr = [door.houseNumber, door.roadName].filter(Boolean).join(" ");
    const repName = door.repName || state.repNameCache.get(door.repId) || door.repId || "";
    const note = door.note || door.notes || "";
    marker.bindPopup(`
      <strong>${escapeHtml(door.status || "Door")}</strong><br>
      ${escapeHtml(timeLine || "")}${addr ? `<br>${escapeHtml(addr)}` : ""}<br>
      <span style="color:#475569;">Rep: ${escapeHtml(repName)}</span>
      ${note ? `<br>${escapeHtml(note)}` : ""}`);
    state.markerCluster.addLayer(marker);
    return marker;
  });

  if (markers.length) {
    try {
      const bounds = L.featureGroup(markers).getBounds();
      state.map.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 });
    } catch (_) {}
  }

  refreshStats();
  updateMapOverlay();
}

function subscribeToShifts() {
  if (state.unsubscribeShifts) state.unsubscribeShifts();
  const shiftRef = tenantCollection(db, state.subscriberId, "repShifts");
  state.unsubscribeShifts = onSnapshot(
    query(shiftRef, orderBy("date", "desc")),
    (snap) => {
      state.shifts = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      state.shifts.sort((a, b) => (a.date === b.date ? ((b.startTime || "") > (a.startTime || "") ? 1 : -1) : (a.date < b.date ? 1 : -1)));
      renderShiftHistory();
      refreshStats();
    },
    (err) => {
      console.warn("repShifts snapshot failed", err);
    }
  );
}

function renderShiftHistory() {
  if (!elements.shiftHistory) return;
  elements.shiftHistory.innerHTML = "";
  const shifts = filterShifts();
  if (!shifts.length) {
    elements.shiftHistory.innerHTML = '<div class="recent-empty">No shifts found for this filter.</div>';
    return;
  }

  shifts.forEach((shift) => {
    const repName = state.repNameCache.get(shift.repId) || shift.repId;
    const item = document.createElement("div");
    item.className = "recent-item";
    item.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <strong>${escapeHtml(shift.date || "Unknown")}</strong>
        <span>Rep: ${escapeHtml(repName)}</span>
        <span>${formatTime(shift.startTime)} – ${shift.endTime ? formatTime(shift.endTime) : "In progress"}</span>
        <span>${shift.totals?.doors || 0} doors • ${(shift.miles ?? 0).toFixed(1)} mi</span>
      </div>`;
    item.addEventListener("click", () => openShiftSummary(shift));
    elements.shiftHistory.appendChild(item);
  });
}

async function openShiftSummary(shift) {
  state.modalShift = shift;
  state.modalLogs = [];
  elements.shiftSummaryBody.textContent = "Loading shift logs…";
  elements.shiftSummaryModal.showModal();

  try {
    const logs = await fetchShiftLogs(shift.repId, shift.date);
    state.modalLogs = logs;
    elements.shiftSummaryBody.innerHTML = buildShiftSummaryHtml(shift, logs);
  } catch (err) {
    console.warn("Failed to load shift logs", err);
    elements.shiftSummaryBody.innerHTML = `<p style="color:#b91c1c;">Unable to load shift details: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function buildShiftSummaryHtml(shift, logs) {
  const totals = computeShiftTotals(shift, logs);
  const pauseItems = (shift.pauses || []).map((pause) => {
    const start = formatTime(pause.start);
    const end = pause.end ? formatTime(pause.end) : "Ongoing";
    return `<li>${start} – ${end} (${escapeHtml(pause.reason || "pause")})</li>`;
  }).join("") || "<li>None</li>";

  const logItems = logs.map((log) => {
    const ts = formatTime(log.timestamp);
    const addr = [log.houseNumber, log.roadName].filter(Boolean).join(" ");
    return `<li><strong>${escapeHtml(log.status || "Door")}</strong> • ${escapeHtml(ts)}${addr ? ` • ${escapeHtml(addr)}` : ""}</li>`;
  }).join("") || "<li>No doors recorded</li>";

  return `
    <table class="summary-table">
      <tr><td>Date</td><td>${escapeHtml(shift.date || "-")}</td></tr>
      <tr><td>Rep</td><td>${escapeHtml(state.repNameCache.get(shift.repId) || shift.repId)}</td></tr>
      <tr><td>Doors</td><td>${totals.doors}</td></tr>
      <tr><td>X / O / Sales</td><td>${totals.x} / ${totals.o} / ${totals.sales}</td></tr>
      <tr><td>Conversion</td><td>${totals.conversion.toFixed(1)}%</td></tr>
      <tr><td>Miles</td><td>${totals.miles.toFixed(2)}</td></tr>
      <tr><td>Doors per active hour</td><td>${totals.dph.toFixed(1)}</td></tr>
      <tr><td>Active minutes</td><td>${totals.activeMinutes}</td></tr>
    </table>
    <h4 style="margin-top:14px;">Pauses</h4>
    <ul class="pause-list">${pauseItems}</ul>
    <h4 style="margin-top:14px;">Logs</h4>
    <ul class="logs-list">${logItems}</ul>
  `;
}

function computeShiftTotals(shift, logs) {
  const doors = logs.length;
  const x = logs.filter((log) => log.status === "X").length;
  const o = logs.filter((log) => log.status === "O").length;
  const sales = logs.filter((log) => log.status === "SignUp").length;
  let miles = shift.miles ?? 0;
  if (!miles && logs.length > 1) {
    for (let i = 1; i < logs.length; i += 1) {
      miles += haversineMiles(
        { lat: logs[i - 1].gpsLat, lng: logs[i - 1].gpsLng },
        { lat: logs[i].gpsLat, lng: logs[i].gpsLng },
      );
    }
  }
  const activeMinutes = shift.activeMinutes ?? 0;
  const hours = activeMinutes ? activeMinutes / 60 : 0;
  const dph = hours ? doors / hours : 0;
  const conversion = doors ? (sales / doors) * 100 : 0;
  return { doors, x, o, sales, miles, activeMinutes, dph, conversion };
}

function highlightShiftOnMap(shift, logs) {
  if (!state.markerCluster) return;
  state.markerCluster.clearLayers();
  const markers = logs
    .filter((log) => typeof log.gpsLat === "number" && typeof log.gpsLng === "number")
    .map((log, index) => {
      const icon = L.divIcon({
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;color:#fff;border:2px solid #fff;font-size:10px;display:flex;align-items:center;justify-content:center;">${index + 1}</div>`,
        className: "shift-marker",
      });
      const marker = L.marker([log.gpsLat, log.gpsLng], { icon });
      const ts = formatTime(log.timestamp);
      marker.bindPopup(`<strong>${escapeHtml(log.status || "Door")}</strong><br>${escapeHtml(ts)}`);
      state.markerCluster.addLayer(marker);
      return marker;
    });

  if (markers.length) {
    try {
      const bounds = L.featureGroup(markers).getBounds();
      state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    } catch (_) {}
  }

  setOverlayMessage(null, false);
  updateMapOverlay();
}

function downloadShiftLogs(shift, logs) {
  const rows = [["timestamp", "status", "repId", "latitude", "longitude", "houseNumber", "roadName", "note"]];
  logs.forEach((log) => {
    rows.push([
      log.timestamp || "",
      log.status || "",
      log.repId || shift.repId,
      log.gpsLat ?? "",
      log.gpsLng ?? "",
      log.houseNumber || "",
      log.roadName || "",
      log.note || log.notes || "",
    ]);
  });
  downloadCsv(rows, `shift-${shift.repId}-${shift.date || "unknown"}.csv`);
}

async function fetchShiftLogs(repId, dateStr) {
  if (!repId || !dateStr) return [];
  const logs = [];

  try {
    const dailySnap = await getDoc(tenantDoc(db, state.subscriberId, "repLogs", `${repId}_${dateStr}`));
    if (dailySnap.exists()) {
      const data = dailySnap.data();
      if (Array.isArray(data.logs)) {
        data.logs.forEach((log) => logs.push({ ...log, repId }));
      }
    }
  } catch (err) {
    console.warn("Daily repLogs fetch failed", err);
  }

  if (!logs.length) {
    try {
      const legacySnap = await getDocs(tenantCollection(db, state.subscriberId, "repLogs", repId, "dates", dateStr, "doorLogs"));
      legacySnap.forEach((docSnap) => logs.push({ id: docSnap.id, ...docSnap.data(), repId }));
    } catch (err) {
      console.warn("Legacy repLogs fetch failed", err);
    }
  }

  return logs
    .filter((log) => log && log.timestamp)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

function refreshStats() {
  const doors = state.filteredDoors;
  const shifts = filterShifts();
  const doorsCount = doors.length;
  const x = doors.filter((door) => door.status === "X").length;
  const o = doors.filter((door) => door.status === "O").length;
  const sales = doors.filter((door) => door.status === "SignUp").length;
  const conversion = doorsCount ? (sales / doorsCount) * 100 : 0;
  const miles = shifts.reduce((acc, shift) => acc + (shift.miles ?? 0), 0);
  const activeMinutes = shifts.reduce((acc, shift) => acc + (shift.activeMinutes ?? 0), 0);
  const dph = activeMinutes ? doorsCount / (activeMinutes / 60) : 0;

  elements.statDoors.textContent = doorsCount.toString();
  elements.statX.textContent = x.toString();
  elements.statO.textContent = o.toString();
  elements.statSales.textContent = sales.toString();
  elements.statConversion.textContent = `${conversion.toFixed(1)}%`;
  elements.statMiles.textContent = miles.toFixed(1);
  elements.statDph.textContent = dph.toFixed(1);
}

function filterShifts() {
  const repFilter = state.filters.rep;
  const start = state.filters.start;
  const end = state.filters.end;
  return state.shifts.filter((shift) => {
    if (repFilter !== "all" && shift.repId !== repFilter) return false;
    if (start && shift.date && shift.date < start) return false;
    if (end && shift.date && shift.date > end) return false;
    return true;
  });
}

function exportDoorsCsv() {
  if (!state.filteredDoors.length) {
    alert("No door activity in the selected range.");
    return;
  }
  const rows = [["timestamp", "status", "repId", "latitude", "longitude", "houseNumber", "roadName", "note"]];
  state.filteredDoors.forEach((door) => {
    rows.push([
      door.timestamp || door.date || "",
      door.status || "",
      door.repId || "",
      door.gpsLat ?? "",
      door.gpsLng ?? "",
      door.houseNumber || "",
      door.roadName || "",
      door.note || door.notes || "",
    ]);
  });
  downloadCsv(rows, `doors-${state.filters.start}-${state.filters.end}.csv`);
}

function downloadCsv(rows, fileName) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function getRepName(repId) {
  if (state.repNameCache.has(repId)) return state.repNameCache.get(repId);
  try {
    const snap = await getDoc(doc(db, "users", repId));
    if (snap.exists()) {
      const data = snap.data();
      const name = data.name || data.repName || data.email || repId;
      state.repNameCache.set(repId, name);
      return name;
    }
  } catch (_) {}
  state.repNameCache.set(repId, repId);
  return repId;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatTime(value) {
  if (!value) return "-";
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    } else if (/^\d{2}:\d{2}/.test(value)) {
      return value;
    }
  }
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function haversineMiles(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371e3;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const s = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  const d = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return (R * d) / 1609.34;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/["&'<>]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
