import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  addDoc,
  deleteDoc,
  getDocs,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { tenantCollection, tenantDoc } from "./lib/subscriber-paths.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";

const ROTA_ASSIGN_KEY = "swashTerritoryAssign";

const DEFAULT_CENTER = { lat: 54.6, lng: -2.9 };

const state = {
  subscriberId: null,
  viewerProfile: null,
  viewerRole: null,
  subscriberProfile: null,
  territories: [],
  selectedId: null,
  map: null,
  drawingManager: null,
  mapPolygons: new Map(),
  activePolygon: null,
  pathListeners: [],
  pendingPath: null,
  isDrawing: false,
  statusTimer: null,
};

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  content: document.getElementById("territoriesContent"),
  status: document.getElementById("territoryStatus"),
  list: document.getElementById("territoryList"),
  name: document.getElementById("territoryName"),
  color: document.getElementById("territoryColor"),
  drawBtn: document.getElementById("drawBoundaryBtn"),
  redrawBtn: document.getElementById("redrawBoundaryBtn"),
  saveBtn: document.getElementById("saveTerritoryBtn"),
  deleteBtn: document.getElementById("deleteTerritoryBtn"),
  hint: document.getElementById("drawingHint"),
  form: document.getElementById("territoryForm"),
  newBtn: document.getElementById("newTerritoryBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  assignBtn: document.getElementById("assignRotaBtn"),
};

init();

function init() {
  initMenu();
  bindEvents();
  startAuth();
}

function initMenu() {
  if (!elements.menuBtn) return;
  elements.menuBtn.addEventListener("click", () => {
    window.location.href = "/main.html";
  });
}

function bindEvents() {
  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (err) {
        console.warn("Sign out failed", err);
      }
      window.location.href = "./subscriber-login.html";
    });
  }

  if (elements.newBtn) {
    elements.newBtn.addEventListener("click", () => {
      exitDrawingMode();
      state.selectedId = null;
      resetForm();
      renderList();
      renderMapOverlays();
      setStatus("Ready to create a new territory.", "info", 4000);
      if (elements.name) elements.name.focus();
    });
  }

  if (elements.drawBtn) {
    elements.drawBtn.addEventListener("click", () => {
      beginDrawing(false);
    });
  }

  if (elements.redrawBtn) {
    elements.redrawBtn.addEventListener("click", () => {
      beginDrawing(true);
    });
  }

  if (elements.form) {
    elements.form.addEventListener("submit", handleSaveTerritory);
  }

  if (elements.deleteBtn) {
    elements.deleteBtn.addEventListener("click", handleDeleteTerritory);
  }

  if (elements.assignBtn) {
    elements.assignBtn.addEventListener("click", handleAssignToRota);
  }

  if (elements.color) {
    elements.color.addEventListener("input", () => {
      const color = elements.color.value || "#2563eb";
      if (state.activePolygon) {
        state.activePolygon.setOptions({ fillColor: color, strokeColor: color });
      }
    });
  }

  if (elements.list) {
    elements.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-territory-id]");
      if (!button) return;
      const { territoryId } = button.dataset;
      if (!territoryId || territoryId === state.selectedId) return;
      selectTerritory(territoryId);
    });
  }
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
      console.error("Failed to load territories", err);
      alert(err.message || "Unable to load territories");
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

  showContent();
  initMapWhenReady();
  await loadTerritories();
  if (!state.territories.length) {
    resetForm();
    setStatus("Use Draw boundary to add your first territory.", "info", 6000);
  }
}

function showContent() {
  if (elements.authOverlay) {
    elements.authOverlay.style.display = "none";
  }
  if (elements.content) {
    elements.content.style.display = "block";
  }
}

function initMapWhenReady() {
  if (state.map) return;
  if (window.google && window.google.maps) {
    buildMap();
  } else {
    document.addEventListener(
      "subscriber-maps-ready",
      () => {
        buildMap();
        renderMapOverlays();
      },
      { once: true }
    );
  }
}

function buildMap() {
  if (state.map || !window.google || !window.google.maps) return;
  const canvas = document.getElementById("territoryMap");
  if (!canvas) return;

  state.map = new google.maps.Map(canvas, {
    center: DEFAULT_CENTER,
    zoom: 6,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  ensureDrawingManager();
}

function ensureDrawingManager() {
  if (state.drawingManager || !state.map || !window.google?.maps?.drawing) return;
  state.drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: null,
    drawingControl: false,
    polygonOptions: defaultPolygonOptions(elements.color?.value || "#2563eb", true),
  });
  state.drawingManager.setMap(state.map);
  google.maps.event.addListener(state.drawingManager, "polygoncomplete", (polygon) => {
    handlePolygonComplete(polygon);
  });
}

function beginDrawing(clearExisting) {
  if (!state.map || !state.drawingManager) {
    setStatus("Map is still loading…", "warn", 4000);
    return;
  }

  exitDrawingMode();

  if (clearExisting) {
    removeActivePolygon();
    state.pendingPath = null;
  }

  state.isDrawing = true;
  clearPathListeners();
  state.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  updateHint("Click to add points. Double-click to finish the shape.");
  setStatus("Drawing mode enabled.", "info", 3000);
}

function handlePolygonComplete(polygon) {
  if (!polygon) return;
  state.drawingManager.setDrawingMode(null);
  state.isDrawing = false;

  removeActivePolygon();
  polygon.setOptions(defaultPolygonOptions(elements.color?.value || "#2563eb", true));
  state.activePolygon = polygon;
  state.pendingPath = extractPath(polygon);
  watchPolygonPath(polygon);
  focusPolygon(polygon);
  updateHint("Drag points to refine the shape, then save.");
  toggleSaveAvailability();
}

function removeActivePolygon() {
  if (state.activePolygon) {
    clearPathListeners();
    if (!state.selectedId) {
      state.activePolygon.setMap(null);
    } else {
      state.activePolygon.setEditable(false);
    }
  }
  state.activePolygon = null;
}

async function loadTerritories(preferredId) {
  if (!state.subscriberId) return;

  const snapshot = await getDocs(tenantCollection(db, state.subscriberId, "territories"));
  state.territories = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

  let nextId;
  if (typeof preferredId !== "undefined") {
    nextId = preferredId;
  } else if (state.selectedId) {
    nextId = state.selectedId;
  } else if (state.territories.length) {
    nextId = state.territories[0].id;
  }

  if (nextId && !state.territories.some((t) => t.id === nextId)) {
    nextId = state.territories.length ? state.territories[0].id : null;
  }
  state.selectedId = nextId || null;

  renderList();
  renderMapOverlays();

  if (state.selectedId) {
    const territory = state.territories.find((t) => t.id === state.selectedId);
    if (territory) {
      populateForm(territory);
      updateHint("Drag points to refine the shape, then save.");
      toggleSaveAvailability();
    }
  } else {
    resetForm();
  }
}

function renderList() {
  if (!elements.list) return;
  if (!state.territories.length) {
    elements.list.innerHTML = '<div class="territory-empty">No territories yet. Use "Draw boundary" to create one.</div>';
    return;
  }

  elements.list.innerHTML = state.territories
    .map((territory) => {
      const active = territory.id === state.selectedId;
      const color = escapeHtml(territory.color || "#2563eb");
      const name = escapeHtml(territory.name || "Untitled territory");
      const meta = formatRotaSummary(territory);
      const classes = ["territory-row"]; if (active) classes.push("territory-row--active");
      return `<button type="button" class="${classes.join(" ")}" data-territory-id="${territory.id}">
        <span class="territory-dot" style="background:${color};border-color:${color};"></span>
        <span>${name}</span>
        <span class="territory-meta">${escapeHtml(meta)}</span>
      </button>`;
    })
    .join("");
}

function renderMapOverlays() {
  if (!state.map || !window.google?.maps) return;

  state.mapPolygons.forEach((polygon) => polygon.setMap(null));
  state.mapPolygons.clear();
  removeActivePolygon();

  state.territories.forEach((territory) => {
    if (!Array.isArray(territory.path) || territory.path.length < 3) return;
    const polygon = new google.maps.Polygon(
      defaultPolygonOptions(territory.color || "#2563eb", territory.id === state.selectedId)
    );
    polygon.setPaths(territory.path.map((point) => ({ lat: point.lat, lng: point.lng })));
    polygon.setMap(state.map);
    polygon.__territoryId = territory.id;
    polygon.addListener("click", () => {
      selectTerritory(territory.id);
    });
    state.mapPolygons.set(territory.id, polygon);
  });

  if (state.selectedId && state.mapPolygons.has(state.selectedId)) {
    state.activePolygon = state.mapPolygons.get(state.selectedId);
    state.activePolygon.setEditable(true);
    watchPolygonPath(state.activePolygon);
    state.pendingPath = extractPath(state.activePolygon);
    focusPolygon(state.activePolygon);
  } else {
    fitMapToTerritories();
  }
}

function selectTerritory(territoryId) {
  const territory = state.territories.find((t) => t.id === territoryId);
  if (!territory) return;

  exitDrawingMode();
  state.selectedId = territoryId;
  populateForm(territory);
  renderList();
  renderMapOverlays();
  setStatus(`Editing ${territory.name || "selected territory"}.`, "info", 4000);
}

function populateForm(territory) {
  if (!territory) return;
  if (elements.name) elements.name.value = territory.name || "";
  if (elements.color) elements.color.value = territory.color || "#2563eb";
  state.pendingPath = Array.isArray(territory.path) ? territory.path.map((point) => ({ ...point })) : null;
  toggleSaveAvailability();
}

function resetForm() {
  if (elements.name) elements.name.value = "";
  if (elements.color) elements.color.value = "#2563eb";
  state.pendingPath = null;
  toggleSaveAvailability();
  updateHint("Click \"Draw boundary\" to sketch a service area.");
}

async function handleSaveTerritory(event) {
  event.preventDefault();
  if (!state.subscriberId) return;

  const name = (elements.name?.value || "").trim();
  if (!name) {
    setStatus("Please add a name for the territory.", "warn", 4000);
    if (elements.name) elements.name.focus();
    return;
  }

  if (!state.pendingPath || state.pendingPath.length < 3) {
    setStatus("Draw a boundary before saving.", "warn", 4000);
    return;
  }

  const color = elements.color?.value || "#2563eb";
  const now = new Date().toISOString();
  const payload = {
    name,
    color,
    path: state.pendingPath,
    centroid: computeCentroid(state.pendingPath),
    type: "polygon",
    updatedAt: now,
  };

  if (!state.selectedId) {
    payload.createdAt = now;
    const docRef = await addDoc(tenantCollection(db, state.subscriberId, "territories"), payload);
    state.selectedId = docRef.id;
    setStatus('Territory created. Use "Assign days in rota" to plan it into your schedule.', "success", 5000);
    await loadTerritories(state.selectedId);
  } else {
    await setDoc(tenantDoc(db, state.subscriberId, "territories", state.selectedId), payload, { merge: true });
    setStatus("Territory updated.", "success", 4000);
    await loadTerritories(state.selectedId);
  }
}

async function handleDeleteTerritory() {
  if (!state.selectedId) {
    setStatus("Select a territory to delete.", "warn", 4000);
    return;
  }
  const territory = state.territories.find((t) => t.id === state.selectedId);
  if (!territory) return;
  const confirmed = window.confirm(`Delete ${territory.name || "this territory"}?`);
  if (!confirmed) return;

  await deleteDoc(tenantDoc(db, state.subscriberId, "territories", state.selectedId));
  setStatus("Territory deleted.", "success", 4000);
  state.selectedId = null;
  await loadTerritories();
}

function handleAssignToRota() {
  if (!state.selectedId) {
    setStatus("Save the territory first, then assign it in the rota.", "warn", 4000);
    return;
  }

  const territory = state.territories.find((t) => t.id === state.selectedId);
  if (!territory) {
    setStatus("Select a territory to assign.", "warn", 4000);
    return;
  }

  const payload = {
    id: territory.id,
    name: territory.name || "",
    color: territory.color || "#2563eb",
    subscriberId: state.subscriberId,
  };

  try {
    sessionStorage.setItem(ROTA_ASSIGN_KEY, JSON.stringify(payload));
  } catch (_) {
    /* ignore storage errors */
  }

  const params = new URLSearchParams(window.location.search || "");
  const tenantFragment = params.get("tenant") ? `&tenant=${encodeURIComponent(params.get("tenant"))}` : "";
  window.location.href = `/schedule.html?assignMode=true&territoryId=${encodeURIComponent(territory.id)}${tenantFragment}`;
}

function toggleSaveAvailability() {
  if (elements.saveBtn) {
    const nameFilled = !!(elements.name?.value || "").trim();
    const hasPath = Array.isArray(state.pendingPath) && state.pendingPath.length >= 3;
    elements.saveBtn.disabled = !(nameFilled && hasPath);
  }
  if (elements.deleteBtn) {
    elements.deleteBtn.disabled = !state.selectedId;
  }
  if (elements.assignBtn) {
    elements.assignBtn.disabled = !state.selectedId;
  }
}

function watchPolygonPath(polygon) {
  clearPathListeners();
  if (!polygon) return;
  const path = polygon.getPath();
  if (!path) return;

  const update = () => {
    state.pendingPath = extractPath(polygon);
    toggleSaveAvailability();
  };

  state.pathListeners = [
    path.addListener("set_at", update),
    path.addListener("insert_at", update),
    path.addListener("remove_at", update),
  ];
  update();
}

function clearPathListeners() {
  state.pathListeners.forEach((listener) => listener.remove());
  state.pathListeners = [];
}

function extractPath(polygon) {
  if (!polygon) return null;
  const path = polygon.getPath();
  if (!path) return null;
  const result = [];
  for (let i = 0; i < path.getLength(); i += 1) {
    const point = path.getAt(i);
    result.push({ lat: Number(point.lat().toFixed(6)), lng: Number(point.lng().toFixed(6)) });
  }
  return result;
}

function computeCentroid(path) {
  if (!Array.isArray(path) || !path.length) return null;
  const sum = path.reduce(
    (acc, point) => {
      acc.lat += Number(point.lat) || 0;
      acc.lng += Number(point.lng) || 0;
      return acc;
    },
    { lat: 0, lng: 0 }
  );
  return {
    lat: Number((sum.lat / path.length).toFixed(6)),
    lng: Number((sum.lng / path.length).toFixed(6)),
  };
}

function formatRotaSummary(territory = {}) {
  const source = territory.rotaDays || territory.assignedDays || territory.assignedRotaDays;
  if (Array.isArray(source) && source.length) {
    const uniqueDays = Array.from(new Set(source.map((value) => String(value).trim()).filter(Boolean)));
    if (uniqueDays.length) {
      return `Rota: ${uniqueDays.join(", ")}`;
    }
  }
  if (territory.allowedBookingDays && typeof territory.allowedBookingDays === "object") {
    const legacyDays = Object.entries(territory.allowedBookingDays)
      .filter(([, value]) => !!value)
      .map(([key]) => key.slice(0, 3).toUpperCase());
    if (legacyDays.length) {
      return `Legacy days: ${legacyDays.join(", ")}`;
    }
  }
  return "Assign in rota";
}

function defaultPolygonOptions(color, editable) {
  return {
    fillColor: color,
    fillOpacity: editable ? 0.25 : 0.18,
    strokeColor: color,
    strokeOpacity: 0.9,
    strokeWeight: editable ? 3 : 2,
    editable: !!editable,
    draggable: !!editable,
    clickable: true,
  };
}

function focusPolygon(polygon) {
  if (!polygon || !state.map) return;
  const bounds = new google.maps.LatLngBounds();
  polygon.getPath().forEach((latLng) => bounds.extend(latLng));
  if (!bounds.isEmpty()) {
    state.map.fitBounds(bounds, 60);
  }
}

function fitMapToTerritories() {
  if (!state.map || !state.mapPolygons.size) {
    if (state.map) {
      state.map.setCenter(DEFAULT_CENTER);
      state.map.setZoom(6);
    }
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;
  state.mapPolygons.forEach((polygon) => {
    polygon.getPath().forEach((latLng) => {
      bounds.extend(latLng);
      hasPoints = true;
    });
  });
  if (hasPoints && !bounds.isEmpty()) {
    state.map.fitBounds(bounds, 80);
  }
}

function updateHint(message) {
  if (!elements.hint) return;
  elements.hint.textContent = message;
}

function setStatus(message, tone = "info", timeoutMs) {
  if (!elements.status) return;
  const tones = {
    info: { bg: "#e0f2fe", color: "#0369a1" },
    success: { bg: "#dcfce7", color: "#166534" },
    warn: { bg: "#fef3c7", color: "#92400e" },
    error: { bg: "#fee2e2", color: "#b91c1c" },
  };
  const palette = tones[tone] || tones.info;
  elements.status.style.background = palette.bg;
  elements.status.style.color = palette.color;
  elements.status.textContent = message;
  elements.status.dataset.visible = "true";

  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
  if (timeoutMs) {
    state.statusTimer = setTimeout(() => {
      elements.status.dataset.visible = "false";
    }, timeoutMs);
  }
}

function exitDrawingMode() {
  if (state.drawingManager) {
    state.drawingManager.setDrawingMode(null);
  }
  state.isDrawing = false;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
