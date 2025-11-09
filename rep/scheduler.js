// scheduler.js - 4-week route planner with drag-and-drop rescheduling and 28-day recurring cadence
import { initMenuDropdown } from "./menu.js";
import { authStateReady, handlePageRouting } from "../auth-check.js";
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  getDoc,
  setDoc,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let schedulerInitialised = false;

const SYNC_CHANNEL_NAME = "swash-quotes-sync";
const SYNC_SOURCE = "scheduler";
const syncChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
let syncReloadInProgress = false;

const INITIAL_WEEKS = 4;
const BASELINE_START_DATE = "2025-11-03"; // Week 1 baseline (Monday 03/11/2025)
const MAX_WEEKS = 8;
const EMAIL_SERVICE = "service_cdy739m";
const EMAIL_TEMPLATE = "template_6mpufs4";
const EMAIL_PUBLIC_KEY = "7HZRYXz3JmMciex1L";

const CLEANER_OPTIONS = Array.from({ length: 10 }, (_, index) => `Cleaner ${index + 1}`);
const CLEANER_ALL = "ALL";
const CLEANER_UNASSIGNED = "UNASSIGNED";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const elements = {
  startWeek: document.getElementById("startWeek"),
  generate: document.getElementById("generate"),
  viewToday: document.getElementById("viewToday"),
  toggleSaturday: document.getElementById("toggleSaturday"),
  search: document.getElementById("scheduleSearch"),
  schedule: document.getElementById("schedule"),
  showPreviousWeek: document.getElementById("showPreviousWeek"),
  showNextWeek: document.getElementById("showNextWeek"),
  dayMessageModal: document.getElementById("dayMessageModal"),
  dayMessageTitle: document.getElementById("dayMessageTitle"),
  dayMessageRecipients: document.getElementById("dayMessageRecipients"),
  dayMessageTemplate: document.getElementById("dayMessageTemplate"),
  dayMessageBody: document.getElementById("dayMessageBody"),
  dayMessageProgress: document.getElementById("dayMessageProgress"),
  dayMessageErrors: document.getElementById("dayMessageErrors"),
  sendDayMessage: document.getElementById("sendDayMessage"),
  dayMessageModeRadios: () => Array.from(document.querySelectorAll('input[name="sendMode"]')),
  dayMessageCancel: document.getElementById("cancelDayMessage"),
  newTemplateSection: document.getElementById("newTemplateSection"),
  newTemplateName: document.getElementById("newTemplateName"),
  saveTemplate: document.getElementById("saveTemplate"),
  deleteTemplateSection: document.getElementById("deleteTemplateSection"),
  deleteTemplate: document.getElementById("deleteTemplate"),
  closeDayMessageModal: document.getElementById("closeDayMessageModal"),
  orderJobsModal: document.getElementById("orderJobsModal"),
  orderJobsTitle: document.getElementById("orderJobsTitle"),
  orderJobsList: document.getElementById("orderJobsList"),
  optimizeRouteBtn: document.getElementById("optimizeRouteBtn"),
  clearOrderBtn: document.getElementById("clearOrderBtn"),
  saveJobOrder: document.getElementById("saveJobOrder"),
  cancelOrderJobs: document.getElementById("cancelOrderJobs"),
  closeOrderJobsModal: document.getElementById("closeOrderJobsModal"),
  selectionInfo: document.getElementById("selectionInfo"),
  selectionCount: document.getElementById("selectionCount"),
  selectionTotal: document.getElementById("selectionTotal"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  cleanerFilter: document.getElementById("cleanerFilter"),
  authOverlay: document.getElementById("authOverlay"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
};

const state = {
  quotes: [],
  startDate: null,
  searchTerm: "",
  draggingIds: [],
  dragOriginDate: null,
  dragTargetJobId: null, // Track which job we're inserting before
  weeksVisible: INITIAL_WEEKS,
  selectedJobIds: new Set(),
  messageContext: null,
  cleanerFilter: "",
  customTemplates: [], // User-saved templates
  areas: [], // User-defined service areas
  currentUserId: null, // Will be set from auth
  orderJobsContext: null, // { dateKey, entries: [{ quote, originalIndex }], optimizedOrder: [] }
  includeSaturday: false, // user preference for showing Saturday in week view
};

// ===== AREAS MANAGEMENT =====
let areasMap = null;
let areasDrawingManager = null;
let currentDrawingPolygon = null;

async function loadAreas() {
  if (!state.currentUserId) return;
  try {
    const areasRef = doc(db, "users", state.currentUserId, "areas", "all");
    const snap = await getDoc(areasRef);
    if (snap.exists()) {
      state.areas = snap.data().areas || [];
    } else {
      state.areas = [];
    }
  } catch (err) {
    console.error("Error loading areas:", err);
    state.areas = [];
  }
}

async function saveAreas() {
  if (!state.currentUserId) return;
  try {
    const areasRef = doc(db, "users", state.currentUserId, "areas", "all");
    await setDoc(areasRef, {
      areas: state.areas,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.error("Error saving areas:", err);
  }
}

function pointInPolygon(point, polygon) {
  const lat = point.lat;
  const lng = point.lng;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    
    const intersect = ((yi > lng) !== (yj > lng)) && (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Convert hex color to tinted (lighter) version with 20% opacity
function tintColor(hexColor) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.15)`;
}

function getAreaForCustomer(quote) {
  if (!quote.customerLatitude || !quote.customerLongitude || !state.areas.length) {
    return null;
  }
  
  const point = { lat: quote.customerLatitude, lng: quote.customerLongitude };
  
  for (const area of state.areas) {
    if (area.type === 'polygon' && area.path && pointInPolygon(point, area.path)) {
      return area;
    }
  }
  return null;
}

function initAreasModal() {
  const defineAreasBtn = document.getElementById("defineAreas");
  const areasModal = document.getElementById("areasModal");
  const closeAreasBtn = document.getElementById("closeAreasModal");
  const cancelAreasBtn = document.getElementById("cancelAreasBtn");
  const drawAreaBtn = document.getElementById("drawAreaBtn");
  const clearAreaBtn = document.getElementById("clearAreaBtn");
  const stopDrawingBtn = document.getElementById("stopDrawingBtn");
  const saveAreaBtn = document.getElementById("saveAreaBtn");

  if (!defineAreasBtn) return;

  defineAreasBtn.addEventListener("click", () => {
    areasModal.hidden = false;
    setTimeout(() => initAreasMapIfNeeded(), 100);
  });

  closeAreasBtn.addEventListener("click", () => {
    areasModal.hidden = true;
  });

  cancelAreasBtn.addEventListener("click", () => {
    areasModal.hidden = true;
  });

  drawAreaBtn.addEventListener("click", () => {
    if (areasDrawingManager) {
      areasDrawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
      drawAreaBtn.hidden = true;
      stopDrawingBtn.hidden = false;
    }
  });

  stopDrawingBtn.addEventListener("click", () => {
    if (areasDrawingManager) {
      areasDrawingManager.setDrawingMode(null);
      stopDrawingBtn.hidden = true;
      drawAreaBtn.hidden = false;
    }
  });

  clearAreaBtn.addEventListener("click", () => {
    if (currentDrawingPolygon) {
      currentDrawingPolygon.setMap(null);
      currentDrawingPolygon = null;
    }
    saveAreaBtn.hidden = true;
    drawAreaBtn.hidden = false;
  });

  saveAreaBtn.addEventListener("click", async () => {
    const name = document.getElementById("areaNameInput")?.value?.trim() || `Area ${state.areas.length + 1}`;
    const color = document.getElementById("areaColorInput")?.value || "#a855f7";

    if (!currentDrawingPolygon) {
      alert("Please draw an area first");
      return;
    }

    const path = currentDrawingPolygon.getPath();
    const polygon = [];
    path.forEach(latLng => {
      polygon.push({ lat: latLng.lat(), lng: latLng.lng() });
    });

    const area = {
      id: Date.now().toString(),
      name: name,
      color: color,
      type: 'polygon',
      path: polygon,
      createdAt: new Date().toISOString(),
    };

    state.areas.push(area);
    await saveAreas();

    currentDrawingPolygon.setMap(null);
    currentDrawingPolygon = null;
    document.getElementById("areaNameInput").value = "";
    renderAreasList();
    renderAreasOnMap();
    saveAreaBtn.hidden = true;
    drawAreaBtn.hidden = false;
    alert(`✓ Area "${name}" created!`);
  });
}

function renderAreasList() {
  const container = document.getElementById("areasList");
  if (!container) return;

  if (!state.areas.length) {
    container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 12px;">No areas created yet</p>';
    return;
  }

  container.innerHTML = state.areas.map(area => `
    <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #f1f5f9; border-radius: 6px;">
      <div style="width: 20px; height: 20px; background-color: ${area.color}; border-radius: 4px;"></div>
      <div style="flex: 1; font-size: 14px; font-weight: 600; color: #1e293b;">${escapeHtml(area.name)}</div>
      <button type="button" class="btn btn-danger btn-sm" onclick="deleteArea('${area.id}')" style="padding: 4px 8px; font-size: 12px;">🗑️</button>
    </div>
  `).join('');
}

window.deleteArea = async function(areaId) {
  if (!confirm("Delete this area?")) return;
  state.areas = state.areas.filter(a => a.id !== areaId);
  await saveAreas();
  renderAreasList();
  renderAreasOnMap();
};

function renderAreasOnMap() {
  if (!areasMap) return;
  
  // Clear existing overlays (except current drawing)
  areasMap.data.forEach((feature) => {
    areasMap.data.remove(feature);
  });

  // Render areas
  state.areas.forEach(area => {
    if (area.type === 'polygon' && area.path) {
      const polygon = new google.maps.Polygon({
        path: area.path.map(p => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        fillColor: area.color,
        fillOpacity: 0.3,
        strokeColor: area.color,
        strokeWeight: 2,
        map: areasMap,
        title: area.name,
      });
    }
  });
}

function getJobMarkerColor(quote) {
  // Green = Paid, Red = Not paid, Orange = Not scheduled yet
  if (!quote.bookedDate) return '#ff9800'; // Orange - not scheduled
  const status = (quote.status || "").toString().toLowerCase();
  const isPaid = quote.paid === true || /paid/.test(status);
  return isPaid ? '#4caf50' : '#f44336'; // Green or Red
}

function renderJobMarkersOnMap() {
  if (!areasMap || !state.quotes.length) return;

  // Clear existing job markers
  if (window.jobMarkers) {
    window.jobMarkers.forEach(marker => marker.setMap(null));
  }
  window.jobMarkers = [];

  // Add markers for each booked quote with coordinates
  state.quotes.forEach(quote => {
    if (!quote.bookedDate) {
      return; // Skip if not booked
    }

    // If has exact coordinates, use them
    if (quote.customerLatitude && quote.customerLongitude) {
      const markerColor = getJobMarkerColor(quote);
      const marker = new google.maps.Marker({
        position: { lat: quote.customerLatitude, lng: quote.customerLongitude },
        map: areasMap,
        title: `${quote.customerName} - ${quote.address}`,
        icon: createMarkerIcon(markerColor, false),
      });

      marker.addListener('click', () => {
        showJobInfoWindow(quote, marker, false);
      });

      window.jobMarkers.push(marker);
    } 
    // If no exact coordinates but has address, geocode it and show as two-tone (approximate + payment status)
    else if (quote.address && window.google && google.maps.Geocoder) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: quote.address }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results.length > 0) {
          const location = results[0].geometry.location;
          const markerColor = getJobMarkerColor(quote); // Get payment status color
          const marker = new google.maps.Marker({
            position: { lat: location.lat(), lng: location.lng() },
            map: areasMap,
            title: `${quote.customerName} - ${quote.address} (Approximate)`,
            icon: createMarkerIcon(markerColor, true), // Two-tone icon
          });

          marker.addListener('click', () => {
            showJobInfoWindow(quote, marker, true);
          });

          window.jobMarkers.push(marker);
        }
      });
    }
  });
}


function createMarkerIcon(color, isApproximate = false) {
  if (!isApproximate) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 0.9,
      strokeColor: '#fff',
      strokeWeight: 2,
      scale: 8,
    };
  } else {
    // Two-tone icon: outer ring in purple (approximate), inner circle in color (payment status)
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: '#9c27b0',
      fillOpacity: 0.5,
      strokeColor: color,
      strokeWeight: 4,
      scale: 10,
    };
  }
}

function showJobInfoWindow(quote, marker, isApproximate = false) {
  // Close any existing info window
  if (window.currentJobInfoWindow) {
    window.currentJobInfoWindow.close();
  }

  const status = getPaymentStatusClass(quote);
  const statusText = status === 'schedule-job--paid' ? '✓ Paid' : '⏳ Unpaid';
  const locationNote = isApproximate ? '<div style="font-size: 11px; color: #9c27b0; font-weight: 600; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e0e0;">📍 Approximate location (geocoded from address)</div>' : '';
  
  const infoContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 12px; max-width: 280px;">
      <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${escapeHtml(quote.customerName)}</div>
      <div style="font-size: 13px; color: #666; margin-bottom: 8px;">${escapeHtml(quote.address)}</div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
        <span><strong>Price:</strong> £${quote.pricePerClean?.toFixed(2) || '0.00'}</span>
        <span style="color: ${status === 'schedule-job--paid' ? '#4caf50' : '#f44336'}; font-weight: 600;">${statusText}</span>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
        <div><strong>Ref:</strong> ${escapeHtml(quote.refCode || 'N/A')}</div>
        <div><strong>Cleaner:</strong> ${escapeHtml(getCleanerDisplay(quote.assignedCleaner))}</div>
      </div>
      ${locationNote}
    </div>
  `;

  window.currentJobInfoWindow = new google.maps.InfoWindow({
    content: infoContent,
    maxWidth: 300,
  });

  window.currentJobInfoWindow.open(areasMap, marker);
}


function waitForGoogleMaps() {
  return new Promise((resolve) => {
    if (window.google && window.google.maps && window.google.maps.drawing) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (window.google && window.google.maps && window.google.maps.drawing) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    }
  });
}

function initAreasMapIfNeeded() {
  if (areasMap) return;

  const mapElement = document.getElementById("areasMap");
  if (!mapElement) return;

  // Ensure Google Maps is loaded before initializing
  if (!window.google || !window.google.maps || !window.google.maps.drawing) {
    console.warn("[Scheduler] Google Maps API not ready, waiting...");
    waitForGoogleMaps().then(() => initAreasMapIfNeeded());
    return;
  }

  areasMap = new google.maps.Map(mapElement, {
    zoom: 12,
    center: { lat: 51.7356, lng: 0.6756 },
    mapTypeId: "roadmap",
  });

  areasDrawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: null,
    drawingControl: false,
    polygonOptions: {
      fillColor: "#a855f7",
      fillOpacity: 0.4,
      strokeColor: "#a855f7",
      strokeWeight: 2,
      editable: true,
      draggable: true,
    },
  });
  areasDrawingManager.setMap(areasMap);

  google.maps.event.addListener(areasDrawingManager, "polygoncomplete", (poly) => {
    currentDrawingPolygon = poly;
    areasDrawingManager.setDrawingMode(null);
    document.getElementById("stopDrawingBtn").hidden = true;
    document.getElementById("drawAreaBtn").hidden = false;
    document.getElementById("saveAreaBtn").hidden = false;
  });

  renderAreasOnMap();
  renderJobMarkersOnMap();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Build a tel: href and normalize common UK formats to E.164 for better mobile compatibility
function formatTelHref(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // strip spaces and common punctuation
  s = s.replace(/[\s\-()]/g, "");
  if (!s) return null;
  // Already E.164
  if (s.startsWith("+")) return `tel:${encodeURIComponent(s)}`;
  // 00 international prefix -> +
  if (/^00\d+/.test(s)) return `tel:%2B${encodeURIComponent(s.slice(2))}`; // %2B is '+'
  // UK 44 without plus -> +44
  if (/^44\d+/.test(s)) return `tel:%2B${encodeURIComponent(s)}`;
  // UK local starting 0 -> +44 minus leading 0
  if (/^0\d+/.test(s)) return `tel:%2B44${encodeURIComponent(s.slice(1))}`;
  // Fallback: raw digits
  return `tel:${encodeURIComponent(s)}`;
}

// Normalize commonly entered UK numbers to E.164 (+44...) for SMS API
function normalizeUkPhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-()]/g, "");
  if (!s) return null;
  if (s.startsWith('+')) return s; // assume already E.164
  if (/^00\d+/.test(s)) return `+${s.slice(2)}`;
  if (/^44\d+/.test(s)) return `+${s}`;
  if (/^0\d+/.test(s)) return `+44${s.slice(1)}`;
  if (/^\d+$/.test(s)) return `+${s}`; // bare digits
  return null;
}

function populateCleanerSelect(
  select,
  { includePlaceholder = false, placeholderLabel = "Select cleaner", includeAll = false, includeUnassigned = false } = {},
) {
  if (!select || select.dataset.cleanerInit) return;
  const options = [];
  if (includePlaceholder) {
    options.push(`<option value="">${escapeHtml(placeholderLabel)}</option>`);
  }
  if (includeAll) {
    options.push(`<option value="${CLEANER_ALL}">All cleaners</option>`);
  }
  if (includeUnassigned) {
    options.push(`<option value="${CLEANER_UNASSIGNED}">Unassigned</option>`);
  }
  CLEANER_OPTIONS.forEach((label) => {
    const safe = escapeHtml(label);
    options.push(`<option value="${safe}">${safe}</option>`);
  });
  select.innerHTML = options.join("");
  select.dataset.cleanerInit = "1";
}

function resolveCleanerUpdate(selection) {
  if (selection === undefined || selection === null || selection === "" || selection === CLEANER_ALL) {
    return { shouldUpdate: false };
  }
  if (selection === CLEANER_UNASSIGNED) {
    return { shouldUpdate: true, value: null };
  }
  return { shouldUpdate: true, value: selection };
}

function getCleanerDisplay(value) {
  return value ? value : "Unassigned";
}

function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

function showAuthOverlay(show) {
  if (!elements.authOverlay) return;
  if (show) {
    elements.authOverlay.removeAttribute("hidden");
  } else {
    elements.authOverlay.setAttribute("hidden", "");
  }
}

function setLoginError(message = "") {
  if (!elements.loginError) return;
  if (message) {
    elements.loginError.textContent = message;
    elements.loginError.removeAttribute("hidden");
  } else {
    elements.loginError.textContent = "";
    elements.loginError.setAttribute("hidden", "");
  }
}

function clearLoginError() {
  setLoginError("");
}

function toDate(input) {
  if (!input) return null;
  if (input.toDate) return input.toDate();
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(input) {
  const date = toDate(input);
  return date ? date.toLocaleDateString("en-GB") : "";
}

function formatCurrency(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function resolvePricePerClean(quote) {
  const candidates = [
    quote.pricePerClean,
    quote.price_per_clean,
    quote.price,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (!Number.isNaN(number) && Number.isFinite(number)) {
      return number;
    }
  }
  return 0;
}

function normalizeStartDate(date) {
  const normalized = new Date(date);
  const day = normalized.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + offset);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getOccurrences(quote, startDate, weeks) {
  const bookedDate = toDate(quote.bookedDate);
  if (!bookedDate) return [];
  const startMs = startDate.getTime();
  const endDate = addDays(startDate, weeks * 7);
  const endMs = endDate.getTime();
  const occurrences = [];
  let current = new Date(bookedDate);
  while (current.getTime() < startMs) {
    current = addDays(current, 28);
  }
  while (current.getTime() < endMs) {
    occurrences.push(new Date(current));
    current = addDays(current, 28);
  }
  return occurrences;
}

async function fetchBookedQuotes() {
  try {
    console.time('[Scheduler] fetchBookedQuotes');
    const quotesRef = collection(db, "quotes");
    const q = query(quotesRef, where("bookedDate", "!=", null));
    const snapshot = await getDocs(q);
    console.log('[Scheduler] Firestore booked docs:', snapshot.size ?? snapshot.docs.length);
    const results = snapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }))
      .filter((quote) => !quote.deleted && quote.bookedDate);
    console.timeEnd('[Scheduler] fetchBookedQuotes');
    return results;
  } catch (error) {
    console.error("Failed to fetch booked quotes", error);
    return [];
  }
}

function buildScheduleMap(startDate, weeks) {
  const map = new Map();
  // Apply cleaner filter: "" or CLEANER_ALL => no filter; CLEANER_UNASSIGNED => missing/empty; otherwise match string
  let filteredQuotes = state.quotes;
  const filter = state.cleanerFilter;
  if (filter && filter !== CLEANER_ALL) {
    if (filter === CLEANER_UNASSIGNED) {
      filteredQuotes = state.quotes.filter((q) => !q.assignedCleaner);
    } else {
      filteredQuotes = state.quotes.filter((q) => q.assignedCleaner === filter);
    }
  }

  filteredQuotes.forEach((quote) => {
    const occurrences = getOccurrences(quote, startDate, weeks);
    occurrences.forEach((date) => {
      const isoKey = toIsoDate(date);
      if (!map.has(isoKey)) {
        map.set(isoKey, []);
      }
      map.get(isoKey).push({ quote, date });
    });
  });
  return map;
}

function applySearchHighlight() {
  const term = state.searchTerm.trim().toLowerCase();
  if (!elements.schedule) return;
  const jobs = elements.schedule.querySelectorAll(".schedule-job");
  jobs.forEach((job) => {
    const text = (job.textContent || "").toLowerCase();
    if (!term || text.includes(term)) {
      job.classList.remove("hidden-by-search");
    } else {
      job.classList.add("hidden-by-search");
    }
  });
}

function renderSchedule() {
  if (!elements.schedule) return;
  const scheduleMap = buildScheduleMap(state.startDate, state.weeksVisible);
  const fragment = document.createDocumentFragment();
  for (let week = 0; week < state.weeksVisible; week += 1) {
    const weekStart = addDays(state.startDate, week * 7);
    const section = document.createElement("section");
    section.className = "schedule-week";
    const header = document.createElement("header");
    header.className = "week-header";
    const weekEnd = addDays(weekStart, state.includeSaturday ? 5 : 4); // Mon–Fri or Mon–Sat
    const weekNumber = getCycleWeekNumber(weekStart);
    header.textContent = `Week ${weekNumber}: ${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    section.appendChild(header);
    const table = document.createElement("div");
    table.className = "schedule-table";
    // Monday–Friday (5) or Monday–Saturday (6)
    const daysInWeek = state.includeSaturday ? 6 : 5;
    for (let dayOffset = 0; dayOffset < daysInWeek; dayOffset += 1) {
      const dayDate = addDays(weekStart, dayOffset);
      const isoKey = toIsoDate(dayDate);
      let entries = scheduleMap.get(isoKey) || [];
      // Stable order: use saved dayOrders if present; otherwise keep current order with index as tiebreaker
      const entriesWithIndex = entries.map((e, i) => ({ ...e, _originalIndex: i }));
      entriesWithIndex.sort((a, b) => {
        const ao = (a.quote.dayOrders && a.quote.dayOrders[isoKey] != null) ? a.quote.dayOrders[isoKey] : (a._originalIndex * 1000);
        const bo = (b.quote.dayOrders && b.quote.dayOrders[isoKey] != null) ? b.quote.dayOrders[isoKey] : (b._originalIndex * 1000);
        if (ao !== bo) return ao - bo;
        // Tiebreaker: use quote ID for stability (ensures deterministic ordering)
        return a.quote.id.localeCompare(b.quote.id);
      });
      entries = entriesWithIndex;
      
  // Calculate total for this day
  const dayTotal = entries.reduce((sum, { quote }) => sum + resolvePricePerClean(quote), 0);
      
  const dayCard = document.createElement("div");
  dayCard.className = "schedule-row";
  dayCard.dataset.date = isoKey;
      
  // Date header
  const dateHeader = document.createElement("div");
  dateHeader.className = "day-cell";
  dateHeader.innerHTML = `
    <span class="day-title">${formatDate(dayDate)}</span>
    <label class="day-select-wrap">
      <input type="checkbox" class="day-select-all" data-date="${isoKey}">
      <span>All</span>
    </label>
  `;
  dayCard.appendChild(dateHeader);
      
  // Jobs container
      const jobsCell = document.createElement("div");
      jobsCell.className = "jobs-cell";
      if (!entries.length) {
        jobsCell.innerHTML = '<div class="day-empty">No jobs</div>';
      } else {
        entries.forEach(({ quote, date }) => {
          const card = document.createElement("div");
          // Status classes
          const statusClass = getPaymentStatusClass(quote);
          card.className = `schedule-job ${statusClass}`;
          card.dataset.id = quote.id;
          card.dataset.date = toIsoDate(date);
          card.draggable = true;
          const isSelected = state.selectedJobIds.has(quote.id);
          const name = escapeHtml(quote.customerName || "Unknown");
          const address = escapeHtml(quote.address || "No address");
          const price = formatCurrency(resolvePricePerClean(quote));
          const pricePerClean = resolvePricePerClean(quote);
          const durationMins = Math.round(pricePerClean);
          const cleaner = escapeHtml(getCleanerDisplay(quote.assignedCleaner));
          const details = buildJobDetailsHtml(quote);
          card.innerHTML = `
            <div class="job-header">
              <label class="job-select">
                <input type="checkbox" ${isSelected ? "checked" : ""} aria-label="Select ${name}">
                <span class="job-select__box"></span>
              </label>
              <div class="job-header__text">
                <div class="job-name">${name}</div>
                <div class="job-address">${address}</div>
                <div class="job-duration">${durationMins}m</div>
              </div>
              <div class="job-meta">
                <span class="job-price">${price}</span>
                <span class="job-cleaner">${cleaner}</span>
                ${isJobCompleted(quote) 
                  ? `<span class="job-status-completed" data-quote-id="${quote.id}" title="Click to undo completion" style="cursor: pointer;" aria-label="Undo job completion">${escapeHtml(getCompletionDisplay(quote))}</span>`
                  : `<button class="job-mark-done" data-quote-id="${quote.id}" title="Send customer receipt and mark complete" aria-label="Mark job as done">Mark done</button>`
                }
              </div>
            </div>
            <div class="schedule-job__details" hidden>
              ${details}
            </div>
          `;
          
          // Apply area color if customer is in an area
          const area = getAreaForCustomer(quote);
          if (area) {
            card.style.backgroundColor = tintColor(area.color);
            card.style.borderColor = area.color;
            card.style.borderWidth = "2px";
          }
          
          jobsCell.appendChild(card);
        });
      }
  dayCard.appendChild(jobsCell);
      
  // Day footer with total and send button
      const dayFooter = document.createElement("div");
      dayFooter.className = "day-actions";

      const totalDiv = document.createElement("div");
      totalDiv.className = "day-total";
      const jobCount = entries.length;
      const jobText = jobCount === 1 ? "Job" : "Jobs";
      
      // Calculate selected jobs for this day
      const selectedQuoteIds = entries
        .filter(e => state.selectedJobIds.has(e.quote.id))
        .map(e => e.quote.id);
      const selectedPrice = entries
        .filter(e => state.selectedJobIds.has(e.quote.id))
        .reduce((sum, e) => sum + resolvePricePerClean(e.quote), 0);
      const selectedDuration = Math.round(selectedPrice);
      
      let selectedText = '';
      if (selectedQuoteIds.length > 0) {
        const selectedCount = selectedQuoteIds.length;
        selectedText = `<div style="font-size: 13px; color: var(--swash-blue); margin-bottom: 6px; font-weight: 500;">Selected: ${formatCurrency(selectedPrice)} of (${selectedDuration}m)</div>`;
      }
      
      totalDiv.innerHTML = `
        ${selectedText}
        <div>Total: ${formatCurrency(dayTotal)}</div>
        <div style="font-size: 14px; color: #5a6c7d; margin-top: 4px;">${jobCount} ${jobText}</div>
      `;
      dayFooter.appendChild(totalDiv);

      const actionsSelect = document.createElement("select");
      actionsSelect.className = "day-actions-select";
      actionsSelect.dataset.date = isoKey;
      actionsSelect.innerHTML = `
        <option value="">Day actions...</option>
        <option value="order">Order jobs 🚗</option>
        <option value="send">Send messages</option>
        <option value="delete">Delete selected 🗑️</option>
      `;
      dayFooter.appendChild(actionsSelect);
      
  dayCard.appendChild(dayFooter);
  table.appendChild(dayCard);
    }
    section.appendChild(table);
    fragment.appendChild(section);
  }
  elements.schedule.innerHTML = "";
  elements.schedule.appendChild(fragment);
  applySearchHighlight();
}

function updateShowNextWeekButton(force) {
  if (!elements.showNextWeek) return;
  const canShow = force === true || state.weeksVisible < MAX_WEEKS;
  elements.showNextWeek.disabled = !canShow;
}

function updateSelectionUI() {
  if (!elements.schedule) return;
  // Update job checkboxes
  elements.schedule.querySelectorAll(".schedule-job").forEach((card) => {
    const checked = state.selectedJobIds.has(card.dataset.id);
    const checkbox = card.querySelector(".job-select input[type=checkbox]");
    if (checkbox) checkbox.checked = checked;
  });
  // Update day select-all checkboxes
  elements.schedule.querySelectorAll('.schedule-row').forEach((row) => {
    const ids = Array.from(row.querySelectorAll('.schedule-job')).map((el) => el.dataset.id);
    const allSelected = ids.length > 0 && ids.every((id) => state.selectedJobIds.has(id));
    const selectAll = row.querySelector('.day-select-all');
    if (selectAll) selectAll.checked = allSelected;
  });

  // Update day-total displays with selected prices
  updateDayTotals();
  
  // Update selection info display
  updateSelectionInfo();
}

function updateDayTotals() {
  if (!elements.schedule) return;
  
  elements.schedule.querySelectorAll('.day-total').forEach((dayTotal) => {
    const dayRow = dayTotal.closest('.schedule-row');
    if (!dayRow) return;
    
    const entries = Array.from(dayRow.querySelectorAll('.schedule-job')).map(card => ({
      id: card.dataset.id,
      quote: state.quotes.find(q => q.id === card.dataset.id)
    }));
    
    const selectedEntries = entries.filter(e => e.quote && state.selectedJobIds.has(e.id));
    const selectedPrice = selectedEntries.reduce((sum, e) => sum + resolvePricePerClean(e.quote), 0);
    const selectedDuration = Math.round(selectedPrice);
    
    // Find the selected text div and update it
    let selectedDiv = dayTotal.querySelector('[class*="selected"]');
    let selectedText = '';
    
    if (selectedEntries.length > 0) {
      selectedText = `<div style="font-size: 13px; color: var(--swash-blue); margin-bottom: 6px; font-weight: 500;">Selected: ${formatCurrency(selectedPrice)} of (${selectedDuration}m)</div>`;
    }
    
    // Update the HTML while preserving the total line
    const totalLineMatch = dayTotal.innerHTML.match(/<div>Total:.*?<\/div>/);
    const jobLineMatch = dayTotal.innerHTML.match(/<div style="font-size: 14px.*?<\/div>/);
    
    dayTotal.innerHTML = `
      ${selectedText}
      ${totalLineMatch ? totalLineMatch[0] : '<div>Total: £0.00</div>'}
      ${jobLineMatch ? jobLineMatch[0] : '<div style="font-size: 14px; color: #5a6c7d; margin-top: 4px;">0 Jobs</div>'}
    `;
  });
}

function updateSelectionInfo() {
  const selectedCount = state.selectedJobIds.size;
  
  if (selectedCount === 0) {
    // Hide selection info if nothing selected
    if (elements.selectionInfo) {
      elements.selectionInfo.hidden = true;
    }
    return;
  }

  // Calculate total price and duration
  let totalPrice = 0;
  let totalDuration = 0; // in minutes

  state.selectedJobIds.forEach((jobId) => {
    const quote = state.quotes.find((q) => q.id === jobId);
    if (quote) {
      const pricePerClean = resolvePricePerClean(quote);
      totalPrice += pricePerClean;
      // Duration is calculated at £1 per minute
      totalDuration += pricePerClean;
    }
  });

  // Format the display
  const countText = selectedCount === 1 ? "1 job" : `${selectedCount} jobs`;
  const priceText = formatCurrency(totalPrice);
  const durationText = totalDuration === 1 ? "1 min" : `${totalDuration} mins`;

  // Update display elements
  if (elements.selectionCount) {
    elements.selectionCount.textContent = countText;
  }

  if (elements.selectionTotal) {
    elements.selectionTotal.innerHTML = `<strong>${priceText}</strong> <span style="color: #64748b; font-size: 0.9rem;">(${durationText})</span>`;
  }

  // Show selection info
  if (elements.selectionInfo) {
    elements.selectionInfo.hidden = false;
  }
}

function clearSelectedJobs() {
  state.selectedJobIds.clear();
  updateSelectionUI();
}

function notifyQuotesUpdated(source = SYNC_SOURCE) {
  if (!syncChannel) return;
  try {
    syncChannel.postMessage({
      type: "quotes-updated",
      source,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.warn("Quotes sync broadcast failed", error);
  }
}

function updateLocalQuote(id, updates) {
  const quote = state.quotes.find((q) => q.id === id);
  if (quote) {
    Object.assign(quote, updates);
  }
}

async function rescheduleQuote(quoteId, newDate) {
  const quote = state.quotes.find((item) => item.id === quoteId);
  if (!quote) return false;
  try {
    const current = toDate(quote.bookedDate);
    if (!current) return false;
    // If dropping back onto the same date, treat as success (no change)
    if (current.toDateString() === newDate.toDateString()) return true;
    const updatedBase = new Date(newDate);
    updatedBase.setHours(0, 0, 0, 0);
    const payload = {
      bookedDate: updatedBase.toISOString(),
      nextCleanDates: [
        updatedBase.toISOString(),
        addDays(updatedBase, 28).toISOString(),
        addDays(updatedBase, 56).toISOString(),
      ],
    };
    await updateDoc(doc(db, "quotes", quoteId), payload);
    quote.bookedDate = payload.bookedDate;
    quote.nextCleanDates = payload.nextCleanDates;
    updateLocalQuote(quoteId, payload);
    notifyQuotesUpdated();
    return true;
  } catch (error) {
    console.error("Failed to reschedule quote", quoteId, error);
    return false;
  }
}

// Reschedule multiple quotes to the same day, preserving their relative order
async function rescheduleQuotes(quoteIds, newDate) {
  const updated = [];
  for (const quoteId of quoteIds) {
    // Run sequentially to avoid overloading and to preserve order
    const ok = await rescheduleQuote(quoteId, newDate);
    if (ok) updated.push(quoteId);
  }
  return updated.length === quoteIds.length;
}

async function refreshData() {
  state.quotes = await fetchBookedQuotes();
  renderSchedule();
}

// Compute and persist a new order index for a quote within a day
async function reorderWithinDay(dateKey, draggedId, beforeId) {
  try {
    console.log("=== reorderWithinDay START ===", { dateKey, draggedId, beforeId });
    
    const scheduleMap = buildScheduleMap(state.startDate, state.weeksVisible);
    const entries = (scheduleMap.get(dateKey) || []).map((e, i) => ({
      id: e.quote.id,
      quote: e.quote,
      key: (e.quote.dayOrders && e.quote.dayOrders[dateKey] != null) ? e.quote.dayOrders[dateKey] : i * 1000,
    })).sort((a, b) => a.key - b.key);

    const draggedIdx = entries.findIndex((x) => x.id === draggedId);
    const targetIdx = entries.findIndex((x) => x.id === beforeId);
    
    if (draggedIdx === -1 || targetIdx === -1) {
      console.error("Could not find dragged or target job", { draggedId, beforeId, draggedIdx, targetIdx });
      return false;
    }
    
    // Skip if no actual movement
    if (draggedIdx === targetIdx) {
      console.log("No movement - dragged index equals target index");
      return true;
    }

    let newKey;
    if (draggedIdx < targetIdx) {
      // Moving down - need to insert AFTER the target (because we filtered out the dragged item)
      // So the new position should be between target and the next item
      const targetKey = entries[targetIdx].key;
      const nextKeyIdx = targetIdx + 1;
      const nextKey = nextKeyIdx < entries.length ? entries[nextKeyIdx].key : targetKey + 1000;
      newKey = (targetKey + nextKey) / 2;
      console.log("Moving DOWN", { draggedId, beforeId, draggedIdx, targetIdx, targetKey, nextKey, newKey });
    } else {
      // Moving up - insert BEFORE the target
      const beforeKey = entries[targetIdx].key;
      const prevKeyIdx = targetIdx - 1;
      const prevKey = prevKeyIdx >= 0 ? entries[prevKeyIdx].key : beforeKey - 1000;
      newKey = (prevKey + beforeKey) / 2;
      console.log("Moving UP", { draggedId, beforeId, draggedIdx, targetIdx, prevKey, beforeKey, newKey });
    }

    // Update local state FIRST before persisting (so render uses updated value)
    const draggedQuote = state.quotes.find((q) => q.id === draggedId);
    if (draggedQuote) {
      if (!draggedQuote.dayOrders) draggedQuote.dayOrders = {};
      draggedQuote.dayOrders[dateKey] = newKey;
      console.log("Local state updated for quote", draggedId, "newKey:", newKey);
    }

    // Persist to Firestore
    const fieldPath = `dayOrders.${dateKey}`;
    await updateDoc(doc(db, "quotes", draggedId), { [fieldPath]: newKey });
    console.log("Firestore persisted", { fieldPath, newKey });
    console.log("=== reorderWithinDay END ===");

    return true;
  } catch (error) {
    console.error("Failed to reorder within day", { dateKey, draggedId, beforeId }, error);
    return false;
  }
}

// Reorder multiple jobs within the same day, inserting the group before target while
// keeping the group's relative order.
async function reorderMultipleWithinDay(dateKey, draggedIds, beforeId) {
  try {
    console.log("=== reorderMultipleWithinDay START ===", { dateKey, draggedIds, beforeId });

    const scheduleMap = buildScheduleMap(state.startDate, state.weeksVisible);
    const entries = (scheduleMap.get(dateKey) || []).map((e, i) => ({
      id: e.quote.id,
      quote: e.quote,
      key: (e.quote.dayOrders && e.quote.dayOrders[dateKey] != null) ? e.quote.dayOrders[dateKey] : i * 1000,
    })).sort((a, b) => a.key - b.key);

    const idSet = new Set(draggedIds);

    // Current list without the dragged group
    const remaining = entries.filter(e => !idSet.has(e.id));

    // Target index (insert before this id). If no beforeId, append at end
    let targetIdx = beforeId ? remaining.findIndex(e => e.id === beforeId) : -1;
    if (targetIdx === -1) targetIdx = remaining.length;

    // Determine key range for insertion
    const prevKey = targetIdx > 0 ? remaining[targetIdx - 1].key : null;
    const nextKey = targetIdx < remaining.length ? remaining[targetIdx]?.key : null;

    let startKey, step;
    const count = draggedIds.length;
    if (prevKey == null && nextKey == null) {
      // Day was empty previously; start keys from 0 with spacing 1000
      startKey = 0;
      step = 1000;
    } else if (prevKey == null) {
      // Insert before first; step backwards from nextKey
      step = 1000;
      startKey = nextKey - step * count;
    } else if (nextKey == null) {
      // Insert at end; step forward after prevKey
      step = 1000;
      startKey = prevKey + step;
    } else {
      // Spread evenly between prev and next
      step = (nextKey - prevKey) / (count + 1);
      if (step <= 0) {
        // Fallback spacing if keys are equal or reversed
        step = 1;
      }
      startKey = prevKey + step;
    }

    // Apply new keys in the current visible order of draggedIds
    for (let i = 0; i < count; i++) {
      const id = draggedIds[i];
      const newKey = startKey + i * step;
      const quote = state.quotes.find(q => q.id === id);
      if (quote) {
        if (!quote.dayOrders) quote.dayOrders = {};
        quote.dayOrders[dateKey] = newKey;
      }
      const fieldPath = `dayOrders.${dateKey}`;
      await updateDoc(doc(db, "quotes", id), { [fieldPath]: newKey });
    }

    console.log("=== reorderMultipleWithinDay END ===");
    return true;
  } catch (error) {
    console.error("Failed to reorder multiple within day", { dateKey, draggedIds, beforeId }, error);
    return false;
  }
}

function closeDayMessageModal() {
  if (!elements.dayMessageModal) return;
  elements.dayMessageModal.setAttribute("hidden", "");
  state.messageContext = null;
  if (elements.dayMessageBody) elements.dayMessageBody.value = "";
  if (elements.dayMessageTemplate) elements.dayMessageTemplate.value = "";
  if (elements.dayMessageProgress) elements.dayMessageProgress.textContent = "";
  if (elements.dayMessageErrors) {
    elements.dayMessageErrors.textContent = "";
    elements.dayMessageErrors.hidden = true;
  }
  if (elements.newTemplateSection) elements.newTemplateSection.hidden = true;
  if (elements.newTemplateName) elements.newTemplateName.value = "";
  
  // Return focus to schedule and enable interactions
  if (elements.schedule) {
    elements.schedule.focus();
  }
}

function openDayMessageModal(dateKey) {
  if (!elements.dayMessageModal) return;
  
  const scheduleMap = buildScheduleMap(state.startDate, state.weeksVisible);
  const allEntries = scheduleMap.get(dateKey) || [];
  
  // Only use selected if any are selected on this specific day
  const selectedOnThisDay = allEntries.filter(({ quote }) => state.selectedJobIds.has(quote.id));
  const entries = selectedOnThisDay.length ? selectedOnThisDay : allEntries;
  
  if (!entries.length) {
    alert("No jobs scheduled for this day.");
    return;
  }
  
  state.messageContext = { dateKey, entries };
  
  // Update modal title
  if (elements.dayMessageTitle) {
    elements.dayMessageTitle.textContent = entries.length === 1 ? "Send Message" : "Send Messages";
  }
  
  // Build recipient list with name - address - email
  if (elements.dayMessageRecipients) {
    const list = entries
      .map(({ quote }) => {
        const name = escapeHtml(quote.customerName || "Unknown");
        const address = escapeHtml(quote.address || "No address");
        const email = escapeHtml(quote.email || quote.customerEmail || "No email");
        return `<li><strong>${name}</strong> - ${address} - ${email}</li>`;
      })
      .join("");
    elements.dayMessageRecipients.innerHTML = `<ul>${list}</ul>`;
  }
  
  // Reset template and message
  if (elements.dayMessageTemplate) elements.dayMessageTemplate.value = "";
  if (elements.dayMessageBody) elements.dayMessageBody.value = "";
  if (elements.dayMessageProgress) elements.dayMessageProgress.textContent = "";
  if (elements.dayMessageErrors) {
    elements.dayMessageErrors.textContent = "";
    elements.dayMessageErrors.hidden = true;
  }
  if (elements.newTemplateSection) elements.newTemplateSection.hidden = true;
  
  // Repopulate template dropdown with saved templates
  populateTemplateDropdown();
  
  // Show modal
  elements.dayMessageModal.removeAttribute("hidden");
  elements.dayMessageBody?.focus();
}

function populateTemplateDropdown() {
  if (!elements.dayMessageTemplate) return;
  const options = [
    '<option value="">Custom message</option>',
    '<option value="reminder">Reminder</option>',
  ];
  state.customTemplates.forEach((tpl, index) => {
    const safeName = escapeHtml(tpl.name);
    options.push(`<option value="custom-${index}">${safeName}</option>`);
  });
  options.push('<option value="new-template">+ Create new template</option>');
  elements.dayMessageTemplate.innerHTML = options.join("");
}

function applyTemplateToBody() {
  if (!elements.dayMessageTemplate || !elements.dayMessageBody) return;
  const template = elements.dayMessageTemplate.value;
  
  // Hide delete button by default
  if (elements.deleteTemplateSection) elements.deleteTemplateSection.hidden = true;
  
  if (template === "new-template") {
    if (elements.newTemplateSection) elements.newTemplateSection.hidden = false;
    elements.dayMessageBody.value = "";
    return;
  }
  
  if (elements.newTemplateSection) elements.newTemplateSection.hidden = true;
  
  if (template === "") {
    elements.dayMessageBody.value = "";
  } else if (template === "reminder") {
    elements.dayMessageBody.value = "Your cleaning is scheduled for tomorrow please leave access";
  } else if (template.startsWith("custom-")) {
    const index = parseInt(template.split("-")[1], 10);
    const tpl = state.customTemplates[index];
    if (tpl) {
      elements.dayMessageBody.value = tpl.message;
      // Show delete button for custom templates
      if (elements.deleteTemplateSection) {
        elements.deleteTemplateSection.hidden = false;
        elements.deleteTemplate.dataset.templateIndex = index;
      }
    }
  }
}

function saveNewTemplate() {
  if (!elements.newTemplateName || !elements.dayMessageBody) return;
  const name = elements.newTemplateName.value.trim();
  const message = elements.dayMessageBody.value.trim();
  if (!name || !message) {
    alert("Please enter both a template name and message.");
    return;
  }
  state.customTemplates.push({ name, message });
  // Save to localStorage
  try {
    localStorage.setItem("swashMessageTemplates", JSON.stringify(state.customTemplates));
  } catch (error) {
    console.error("Failed to save templates", error);
  }
  alert(`Template "${name}" saved!`);
  elements.newTemplateName.value = "";
  if (elements.newTemplateSection) elements.newTemplateSection.hidden = true;
  populateTemplateDropdown();
}

function deleteTemplate() {
  if (!elements.deleteTemplate) return;
  const index = parseInt(elements.deleteTemplate.dataset.templateIndex, 10);
  const tpl = state.customTemplates[index];
  if (!tpl || isNaN(index)) return;
  
  if (!confirm(`Delete template "${tpl.name}"?`)) return;
  
  // Remove from array
  state.customTemplates.splice(index, 1);
  
  // Save to localStorage
  try {
    localStorage.setItem("swashMessageTemplates", JSON.stringify(state.customTemplates));
  } catch (error) {
    console.error("Failed to save templates", error);
  }
  
  // Reset template dropdown and hide delete button
  populateTemplateDropdown();
  if (elements.dayMessageTemplate) elements.dayMessageTemplate.value = "";
  if (elements.deleteTemplateSection) elements.deleteTemplateSection.hidden = true;
  elements.dayMessageBody.value = "";
}

function loadCustomTemplates() {
  try {
    const saved = localStorage.getItem("swashMessageTemplates");
    if (saved) {
      state.customTemplates = JSON.parse(saved);
    }
  } catch (error) {
    console.error("Failed to load templates", error);
  }
}

async function handleMarkJobDone(quoteId) {
  // Find the quote in our data
  const quote = state.quotes.find(q => q.id === quoteId);
  if (!quote) {
    alert("Quote not found");
    return;
  }
  
  // Get email
  const recipientEmail = quote.email || quote.customerEmail;
  if (!recipientEmail) {
    alert(`No email address for ${quote.customerName || "customer"}`);
    return;
  }
  
  // Check EmailJS is loaded
  if (!window.emailjs || typeof emailjs.send !== "function") {
    alert("EmailJS not loaded. Cannot send receipt.");
    return;
  }
  
  // Show custom confirmation dialog with Yes/No/Cancel
  const userConfirmed = await new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 300px;
      text-align: center;
    `;
    
    const message = document.createElement('p');
    message.textContent = `Send completion receipt to ${quote.customerName}?`;
    message.style.cssText = 'margin: 0 0 20px 0; font-size: 16px; color: #333;';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;';
    
    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Yes';
    yesBtn.style.cssText = `
      background: #0078d7;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    yesBtn.onmouseover = () => yesBtn.style.background = '#005a9c';
    yesBtn.onmouseout = () => yesBtn.style.background = '#0078d7';
    yesBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(true);
    };
    
    const noBtn = document.createElement('button');
    noBtn.textContent = 'No';
    noBtn.style.cssText = `
      background: #6c757d;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    noBtn.onmouseover = () => noBtn.style.background = '#5a6268';
    noBtn.onmouseout = () => noBtn.style.background = '#6c757d';
    noBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: #e2e6eb;
      color: #333;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    cancelBtn.onmouseover = () => cancelBtn.style.background = '#d1d5db';
    cancelBtn.onmouseout = () => cancelBtn.style.background = '#e2e6eb';
    cancelBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    buttonContainer.appendChild(yesBtn);
    buttonContainer.appendChild(noBtn);
    buttonContainer.appendChild(cancelBtn);
    
    dialog.appendChild(message);
    dialog.appendChild(buttonContainer);
    
    // Overlay to dim background
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
    `;
    overlay.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
    yesBtn.focus();
  });
  
  // Mark job as completed regardless of receipt email choice
  const completionDate = new Date().toLocaleDateString("en-GB");
  const updateData = {
    status: "Completed - " + completionDate,
    completedDate: new Date().toISOString(),
  };
  
  try {
    // Send receipt email if user confirmed
    if (userConfirmed) {
      const receiptMessage = `
Your cleaning has been completed. Thank you for choosing Swash!

Customer: ${quote.customerName || "N/A"}
Address: ${quote.address || "N/A"}
Reference: ${quote.refCode || "N/A"}
Price: £${quote.pricePerClean || "0"}

If you have any questions, please don't hesitate to contact us.

Best regards,
Swash Team
      `.trim();
      
      await emailjs.send(EMAIL_SERVICE, EMAIL_TEMPLATE, {
        title: "Cleaning Completed - Receipt",
        name: quote.customerName || "Customer",
        message: receiptMessage,
        email: recipientEmail,
      });
      
      // Update Firestore with email log
      await updateDoc(doc(db, "quotes", quoteId), {
        status: "Completed - " + completionDate,
        completedDate: new Date().toISOString(),
        emailLog: arrayUnion({
          type: "receipt",
          subject: "Cleaning Completed - Receipt",
          sentAt: Date.now(),
          sentTo: recipientEmail,
          success: true,
          body: receiptMessage,
          sentBy: (function(){
            const u = auth?.currentUser || null;
            return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "rep-scheduler" };
          })(),
        })
      });
    } else {
      // Mark as completed without email log
      await updateDoc(doc(db, "quotes", quoteId), {
        status: "Completed - " + completionDate,
        completedDate: new Date().toISOString(),
      });
    }
    
    // Show success notification
    const notification = document.createElement("div");
    notification.className = "notification notification--success";
    const notificationMessage = userConfirmed ? `Receipt sent to ${recipientEmail}` : `Job marked as completed`;
    notification.textContent = notificationMessage;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    
    // Auto-remove notification after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease";
      setTimeout(() => notification.remove(), 300);
    }, 3000);
    
    // Refresh schedule to show updated status
    refreshData();
    
  } catch (error) {
    console.error("Failed to mark job as done", error);
    
    // Log failed receipt email only if email was attempted
    if (userConfirmed) {
      try {
        await updateDoc(doc(db, "quotes", quoteId), {
          emailLog: arrayUnion({
            type: "receipt",
            subject: "Cleaning Completed - Receipt",
            sentAt: Date.now(),
            sentTo: recipientEmail,
            success: false,
            error: error?.message || "Send failed",
            body: receiptMessage,
            sentBy: (function(){
              const u = auth?.currentUser || null;
              return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "rep-scheduler" };
            })(),
          })
        });
      } catch (logError) {
        console.warn("Failed to log email failure", logError);
      }
    }
    
    alert(`Failed to send receipt: ${error.message || "Unknown error"}`);
  }
}

async function handleUndoCompletion(quoteId) {
  const quote = state.quotes.find((q) => q.id === quoteId);
  if (!quote) {
    alert("Quote not found");
    return;
  }

  // Show undo confirmation dialog
  const confirmed = await new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 300px;
      text-align: center;
    `;
    
    const title = document.createElement('h3');
    title.textContent = 'Undo';
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; color: #333;';
    
    const message = document.createElement('p');
    message.textContent = `Mark ${quote.customerName || 'this job'} as incomplete?`;
    message.style.cssText = 'margin: 0 0 20px 0; font-size: 14px; color: #666;';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = `
      background: #0078d7;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    confirmBtn.onmouseover = () => confirmBtn.style.background = '#005a9c';
    confirmBtn.onmouseout = () => confirmBtn.style.background = '#0078d7';
    confirmBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(true);
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: #e2e6eb;
      color: #333;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    cancelBtn.onmouseover = () => cancelBtn.style.background = '#d1d5db';
    cancelBtn.onmouseout = () => cancelBtn.style.background = '#e2e6eb';
    cancelBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    buttonContainer.appendChild(confirmBtn);
    buttonContainer.appendChild(cancelBtn);
    
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(buttonContainer);
    
    // Overlay to dim background
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
    `;
    overlay.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
    confirmBtn.focus();
  });

  if (!confirmed) {
    return;
  }

  // Undo completion by clearing status and completedDate
  try {
    await updateDoc(doc(db, "quotes", quoteId), {
      status: quote.tier ? quote.tier : "Quoted",
      completedDate: null,
    });

    // Show success notification
    const notification = document.createElement("div");
    notification.className = "notification notification--success";
    notification.textContent = `Completion undone`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);

    // Auto-remove notification after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease";
      setTimeout(() => notification.remove(), 300);
    }, 3000);

    // Refresh schedule to show updated status
    refreshData();
  } catch (error) {
    console.error("Failed to undo completion", error);
    alert(`Failed to undo: ${error.message || "Unknown error"}`);
  }
}

function openOrderJobsModal(dateKey) {
  // Get jobs for this date
  const isoKey = dateKey;
  const entries = (state.quotes || [])
    .filter((quote) => !quote.deleted && quote.bookedDate)
    .flatMap((quote) => {
      const cleans = getOccurrences(quote, state.startDate, state.weeksVisible);
      return cleans
        .filter((clean) => {
          const cleanDateStr = clean.toISOString().split("T")[0];
          return cleanDateStr === isoKey;
        })
        .map((clean, idx) => ({
          quote,
          cleanIndex: idx,
          _originalIndex: state.quotes.indexOf(quote),
        }));
    });

  if (entries.length === 0) {
    alert("No jobs scheduled for this day");
    return;
  }

  // Store in state with map markers and route context
  state.orderJobsContext = {
    dateKey: isoKey,
    entries: entries,
    optimizedOrder: entries.map((e) => e.quote.id),
    map: null,
    markers: [],
    polyline: null,
    trafficLayer: null,
    trafficVisible: false,
    startLocation: null,
    finishLocation: null,
    startLocationCoords: null,
    finishLocationCoords: null,
    startTime: 8 * 60, // 8am in minutes
    finishTime: 17 * 60, // 5pm in minutes
    directionsService: new google.maps.DirectionsService(),
    geocoder: new google.maps.Geocoder(),
  };

  // Update modal title
  const dateObj = new Date(isoKey + "T00:00:00Z");
  const dateStr = dateObj.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (elements.orderJobsTitle) {
    elements.orderJobsTitle.textContent = `Route Planner - ${dateStr}`;
  }

  // Show modal first
  if (elements.orderJobsModal) {
    elements.orderJobsModal.hidden = false;
  }

  // Initialize map and route after modal is visible
  setTimeout(() => {
    initializeRoutePlannerMap();
    initializeRoutePlannerInputs();
    renderRouteTimeline();
  }, 100);
}

function initializeRoutePlannerMap() {
  if (!document.getElementById('routePlannerMap')) return;
  
  const context = state.orderJobsContext;
  if (!context) return;

  // Create map centered on first job
  const firstQuote = context.entries[0]?.quote;
  if (!firstQuote || !firstQuote.customerLatitude || !firstQuote.customerLongitude) {
    console.error("First job missing coordinates");
    return;
  }

  const initialCenter = {
    lat: firstQuote.customerLatitude,
    lng: firstQuote.customerLongitude,
  };

  context.map = new google.maps.Map(document.getElementById('routePlannerMap'), {
    zoom: 12,
    center: initialCenter,
    mapTypeControl: true,
    streetViewControl: false,
  });

  // Clear previous markers
  context.markers.forEach(m => m.setMap(null));
  context.markers = [];

  // Add markers for each job
  const orderedQuotes = context.optimizedOrder
    .map(id => context.entries.find(e => e.quote.id === id)?.quote)
    .filter(Boolean);

  orderedQuotes.forEach((quote, idx) => {
    if (!quote.customerLatitude || !quote.customerLongitude) return;

    const marker = new google.maps.Marker({
      position: {
        lat: quote.customerLatitude,
        lng: quote.customerLongitude,
      },
      map: context.map,
      label: String(idx + 1),
      title: `${idx + 1}. ${quote.customerName}`,
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-size: 0.9rem;">
          <strong>${idx + 1}. ${escapeHtml(quote.customerName)}</strong><br>
          ${escapeHtml(quote.address || 'No address')}<br>
          <span style="color: #0078d7; font-weight: 500;">£${quote.pricePerClean} (${Math.round(quote.pricePerClean)}m)</span>
        </div>
      `,
    });

    marker.addListener('click', () => {
      context.markers.forEach(m => m.infoWindow && m.infoWindow.close());
      infoWindow.open(context.map, marker);
    });

    marker.infoWindow = infoWindow;
    context.markers.push(marker);
  });

  // Fit map to markers
  if (context.markers.length > 0) {
    const bounds = new google.maps.LatLngBounds();
    context.markers.forEach(m => bounds.extend(m.getPosition()));
    context.map.fitBounds(bounds);
  }

  // Draw initial route
  drawRoutePath();

  // Initialize traffic layer
  const trafficBtn = document.getElementById('trafficToggleBtn');
  if (trafficBtn) {
    trafficBtn.addEventListener('click', toggleTrafficLayer);
  }
}

function toggleTrafficLayer() {
  const context = state.orderJobsContext;
  if (!context || !context.map) return;

  if (!context.trafficLayer) {
    context.trafficLayer = new google.maps.TrafficLayer();
  }

  context.trafficVisible = !context.trafficVisible;

  if (context.trafficVisible) {
    context.trafficLayer.setMap(context.map);
    document.getElementById('trafficToggleBtn').style.background = '#4caf50';
    document.getElementById('trafficToggleBtn').style.color = 'white';
  } else {
    context.trafficLayer.setMap(null);
    document.getElementById('trafficToggleBtn').style.background = '';
    document.getElementById('trafficToggleBtn').style.color = '';
  }
}

function initializeRoutePlannerInputs() {
  const startLocInput = document.getElementById('routeStartLocation');
  const finishLocInput = document.getElementById('routeFinishLocation');
  const startTimeInput = document.getElementById('routeStartTime');
  const finishTimeInput = document.getElementById('routeFinishTime');

  if (!startLocInput || !finishLocInput) return;

  // Default start location - always use this, never first job address
  const DEFAULT_START_LOCATION = 'SS4 1PF';
  
  const context = state.orderJobsContext;
  
  // Always use default start location
  startLocInput.value = DEFAULT_START_LOCATION;
  context.startLocation = DEFAULT_START_LOCATION;
  finishLocInput.value = DEFAULT_START_LOCATION;
  context.finishLocation = DEFAULT_START_LOCATION;

  // Set default times
  if (startTimeInput) startTimeInput.value = '08:00';
  if (finishTimeInput) finishTimeInput.value = '17:00';

  // Add event listeners for both 'change' and 'input' events to catch all edits
  if (startLocInput) {
    const handleStartLocChange = () => {
      context.startLocation = startLocInput.value;
      // Auto-sync finish location to start location
      finishLocInput.value = startLocInput.value;
      context.finishLocation = startLocInput.value;
      // Redraw route with new locations
      drawRoutePath();
    };
    startLocInput.addEventListener('change', handleStartLocChange);
    startLocInput.addEventListener('input', handleStartLocChange);
  }

  if (finishLocInput) {
    const handleFinishLocChange = () => {
      context.finishLocation = finishLocInput.value;
      // Redraw route with new locations
      drawRoutePath();
    };
    finishLocInput.addEventListener('change', handleFinishLocChange);
    finishLocInput.addEventListener('input', handleFinishLocChange);
  }

  if (startTimeInput) {
    startTimeInput.addEventListener('change', () => {
      const [h, m] = startTimeInput.value.split(':').map(Number);
      context.startTime = h * 60 + m;
      renderRouteTimeline();
    });
  }

  if (finishTimeInput) {
    finishTimeInput.addEventListener('change', () => {
      const [h, m] = finishTimeInput.value.split(':').map(Number);
      context.finishTime = h * 60 + m;
      renderRouteTimeline();
    });
  }
}

async function drawRoutePath() {
  const context = state.orderJobsContext;
  if (!context || !context.map || context.entries.length === 0) return;

  // Get ordered quotes
  const orderedQuotes = context.optimizedOrder
    .map(id => context.entries.find(e => e.quote.id === id)?.quote)
    .filter(q => q && q.customerLatitude && q.customerLongitude);

  if (orderedQuotes.length < 1) return;

  try {
    // Geocode start location if provided and not already cached
    let startCoords = context.startLocationCoords;
    if (context.startLocation && !startCoords) {
      const startResult = await geocodeAddress(context.startLocation);
      if (startResult) {
        startCoords = startResult;
        context.startLocationCoords = startResult;
      }
    }

    // Geocode finish location if provided and not already cached
    let finishCoords = context.finishLocationCoords;
    if (context.finishLocation && !finishCoords) {
      const finishResult = await geocodeAddress(context.finishLocation);
      if (finishResult) {
        finishCoords = finishResult;
        context.finishLocationCoords = finishResult;
      }
    }

    // Use start coords if available, otherwise use first job
    const originCoords = startCoords || new google.maps.LatLng(
      orderedQuotes[0].customerLatitude,
      orderedQuotes[0].customerLongitude
    );

    // Use finish coords if available, otherwise use last job
    const destinationCoords = finishCoords || new google.maps.LatLng(
      orderedQuotes[orderedQuotes.length - 1].customerLatitude,
      orderedQuotes[orderedQuotes.length - 1].customerLongitude
    );

    // Build waypoints - include all job locations
    const waypoints = orderedQuotes.map(quote => ({
      location: new google.maps.LatLng(quote.customerLatitude, quote.customerLongitude),
      stopover: true,
    }));

    const request = {
      origin: originCoords,
      destination: destinationCoords,
      waypoints: waypoints,
      travelMode: google.maps.TravelMode.DRIVING,
    };

    const result = await context.directionsService.route(request);

    // Clear previous polyline
    if (context.polyline) context.polyline.setMap(null);

    // Draw route polyline
    context.polyline = new google.maps.Polyline({
      path: result.routes[0].overview_path,
      geodesic: true,
      strokeColor: '#0078d7',
      strokeOpacity: 0.7,
      strokeWeight: 3,
      map: context.map,
    });

    // Update timeline with actual route data
    renderRouteTimeline(result);
  } catch (error) {
    console.error('Route error:', error);
  }
}

async function geocodeAddress(address) {
  const context = state.orderJobsContext;
  if (!context || !context.geocoder) return null;

  try {
    const result = await new Promise((resolve, reject) => {
      context.geocoder.geocode({ address }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results[0]) {
          resolve(results[0].geometry.location);
        } else {
          reject(new Error(`Geocoding failed: ${status}`));
        }
      });
    });
    return result;
  } catch (error) {
    console.warn(`Could not geocode "${address}":`, error);
    return null;
  }
}

function renderRouteTimeline(directionsResult = null) {
  const context = state.orderJobsContext;
  if (!context) return;

  const timelineDiv = document.getElementById('routeTimeline');
  if (!timelineDiv) return;

  const orderedQuotes = context.optimizedOrder
    .map(id => context.entries.find(e => e.quote.id === id)?.quote)
    .filter(Boolean);

  let currentTime = context.startTime; // minutes from midnight
  let totalWorkTime = 0;
  let html = '';

  // Extract real travel durations from Directions API when available
  // legsDurations[i] = minutes to travel from origin/prev stop to next stop
  let legsDurations = [];
  if (directionsResult && directionsResult.routes && directionsResult.routes[0] && directionsResult.routes[0].legs) {
    try {
      legsDurations = directionsResult.routes[0].legs.map((leg) => {
        const sec = (leg.duration && leg.duration.value) ? leg.duration.value : 0;
        return Math.max(0, Math.round(sec / 60));
      });
    } catch (_) {
      legsDurations = [];
    }
  }

  // Helper to get travel minutes between stops. If not available, default to 15m
  const getTravelMins = (index) => {
    // index 0 = origin -> first job, index n = last job -> destination
    if (index >= 0 && index < legsDurations.length) return legsDurations[index];
    return 15;
  };

  // Lunch handling
  const LUNCH_TIME = 13 * 60; // 13:00
  const LUNCH_DURATION = 60; // 60 minutes
  let lunchTaken = false;
  const maybeInsertLunchDuringGap = (gapStart, gapMinutes) => {
    if (lunchTaken) return 0; // no adjustment
    const gapEnd = gapStart + gapMinutes;
    // If we cross 13:00 during this gap, insert lunch at exactly 13:00
    if (gapStart < LUNCH_TIME && gapEnd > LUNCH_TIME) {
      // Time already elapsed before lunch within this gap
      const beforeLunch = LUNCH_TIME - gapStart;
      // Remaining after lunch within this same gap
      const afterLunch = gapEnd - LUNCH_TIME;
      // Move clock to end of lunch, then add the remaining portion
      currentTime = LUNCH_TIME + LUNCH_DURATION + afterLunch;
      html += `
        <div class="route-timeline-item break">
          <div class="route-timeline-time">${formatTime(LUNCH_TIME)}</div>
          <div class="route-timeline-job">
            <div class="route-timeline-job-name">🍽️ Lunch Break</div>
            <div class="route-timeline-duration">${LUNCH_DURATION} minutes</div>
          </div>
        </div>
      `;
      lunchTaken = true;
      return gapMinutes; // full gap consumed (handled by advancing currentTime above)
    }
    return 0; // no lunch inserted here
  };

  // Start location
  html += `
    <div class="route-timeline-item">
      <div class="route-timeline-time">${formatTime(currentTime)}</div>
      <div class="route-timeline-job">
        <div class="route-timeline-job-name">📍 Start: ${escapeHtml(context.startLocation || 'Starting point')}</div>
      </div>
    </div>
  `;

  // Jobs with travel time
  orderedQuotes.forEach((quote, idx) => {
    const jobDuration = Math.max(0, Math.round(resolvePricePerClean(quote)));
    totalWorkTime += jobDuration;

    // Travel to this job (from start for idx 0, or from previous job)
    const travelToJob = getTravelMins(idx); // leg idx maps to origin->job0, job0->job1, etc.

    // If we haven't taken lunch, check if lunch occurs during this travel
    if (!lunchTaken && travelToJob > 0) {
      const consumed = maybeInsertLunchDuringGap(currentTime, travelToJob);
      if (consumed === 0) {
        currentTime += travelToJob;
      }
      // if consumed > 0, currentTime was already advanced inside maybeInsertLunchDuringGap
    } else {
      currentTime += travelToJob;
    }

    // If we passed 13:00 earlier due to a long morning job without an opportunity,
    // insert lunch now before starting this job
    if (!lunchTaken && currentTime >= LUNCH_TIME) {
      html += `
        <div class="route-timeline-item break">
          <div class="route-timeline-time">${formatTime(Math.max(LUNCH_TIME, currentTime))}</div>
          <div class="route-timeline-job">
            <div class="route-timeline-job-name">🍽️ Lunch Break</div>
            <div class="route-timeline-duration">${LUNCH_DURATION} minutes</div>
          </div>
        </div>
      `;
      currentTime = Math.max(LUNCH_TIME, currentTime) + LUNCH_DURATION;
      lunchTaken = true;
    }

    // Render the job starting at currentTime
    html += `
      <div class="route-timeline-item">
        <div class="route-timeline-time">${formatTime(currentTime)}</div>
        <div class="route-timeline-job">
          <div class="route-timeline-job-name">${idx + 1}. ${escapeHtml(quote.customerName)}</div>
          <div class="route-timeline-duration">${escapeHtml(quote.address)} • ${jobDuration}m job</div>
        </div>
      </div>
    `;

    const jobStart = currentTime;
    currentTime += jobDuration; // job work time

    // If lunch time falls between job start and end, insert lunch after job
    if (!lunchTaken && jobStart < LUNCH_TIME && currentTime >= LUNCH_TIME) {
      html += `
        <div class="route-timeline-item break">
          <div class="route-timeline-time">${formatTime(LUNCH_TIME)}</div>
          <div class="route-timeline-job">
            <div class="route-timeline-job-name">🍽️ Lunch Break</div>
            <div class="route-timeline-duration">${LUNCH_DURATION} minutes</div>
          </div>
        </div>
      `;
      currentTime = LUNCH_TIME + LUNCH_DURATION;
      lunchTaken = true;
    }
  });

  // Travel to finish location (last leg)
  const travelToFinish = getTravelMins(orderedQuotes.length);

  if (!lunchTaken) {
    // Check if lunch occurs during final travel
    const consumed = maybeInsertLunchDuringGap(currentTime, travelToFinish);
    if (consumed === 0) currentTime += travelToFinish; // otherwise already advanced
  } else {
    currentTime += travelToFinish;
  }

  // Finish location
  html += `
    <div class="route-timeline-item">
      <div class="route-timeline-time">${formatTime(currentTime)}</div>
      <div class="route-timeline-job">
        <div class="route-timeline-job-name">🏁 Finish: ${escapeHtml(context.finishLocation || 'Finish location')}</div>
      </div>
    </div>
  `;

  timelineDiv.innerHTML = html;

  // Update totals
  const totalDuration = currentTime - context.startTime;
  document.getElementById('totalRouteDuration').textContent = formatMinutesToHours(totalDuration);
  document.getElementById('totalWorkDuration').textContent = formatMinutesToHours(totalWorkTime);
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatMinutesToHours(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function handleOrderJobDragEnd(e) {
  this.style.opacity = "1";
  orderJobsDraggedItem = null;

  // Update the optimized order based on new DOM order
  if (state.orderJobsContext && elements.orderJobsList) {
    const newOrder = Array.from(elements.orderJobsList.querySelectorAll(".order-job-item")).map(
      (item) => item.dataset.quoteId
    );
    state.orderJobsContext.optimizedOrder = newOrder;

    // Re-render to update numbers
    renderOrderJobsList();
  }
}

async function handleOptimizeRoute() {
  if (!state.orderJobsContext || state.orderJobsContext.entries.length === 0) {
    alert("No jobs to optimize");
    return;
  }

  const { entries } = state.orderJobsContext;
  const btn = elements.optimizeRouteBtn;
  const originalText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "🔄 Optimizing...";
  }

  try {
    // Build waypoints for route optimization
    const waypoints = entries
      .map((entry) => {
        const { quote } = entry;
        // Use latitude/longitude if available
        if (quote.customerLatitude && quote.customerLongitude) {
          return {
            location: new google.maps.LatLng(quote.customerLatitude, quote.customerLongitude),
            quoteId: quote.id,
          };
        }
        return null;
      })
      .filter((w) => w !== null);

    if (waypoints.length < 2) {
      alert("Need at least 2 valid job addresses to optimize");
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      return;
    }

    // Use promise with timeout for optimization
    const optimizePromise = new Promise((resolve, reject) => {
      const directionsService = new google.maps.DirectionsService();
      const start = waypoints[0];
      const end = waypoints[waypoints.length - 1];
      const middle = waypoints.slice(1, -1);

      const request = {
        origin: start.location,
        destination: end.location,
        waypoints: middle.map((w) => ({ location: w.location, stopover: true })),
        optimizeWaypoints: true,
        travelMode: google.maps.TravelMode.DRIVING,
      };

      // Add 10 second timeout
      const timeoutId = setTimeout(() => {
        reject(new Error("Route optimization timed out"));
      }, 10000);

      directionsService.route(request, (result, status) => {
        clearTimeout(timeoutId);

        if (status === google.maps.DirectionsStatus.OK) {
          // Extract optimized order from result
          const optimizedOrder = [start.quoteId];

          // Map waypoint indices back to quote IDs
          const waypointOrder = result.routes[0].waypoint_order;
          waypointOrder.forEach((idx) => {
            optimizedOrder.push(middle[idx].quoteId);
          });

          optimizedOrder.push(end.quoteId);
          resolve({ optimizedOrder, start, end });
        } else {
          reject(new Error(`Route optimization failed: ${status}`));
        }
      });
    });

    const { optimizedOrder } = await optimizePromise;

    // Update state
    state.orderJobsContext.optimizedOrder = optimizedOrder;

    // Re-sort entries based on optimized order
    const oldEntries = state.orderJobsContext.entries;
    state.orderJobsContext.entries = optimizedOrder.map((qId) =>
      oldEntries.find((e) => e.quote.id === qId)
    );

    // Re-render the route with new order
    drawRoutePath();

    // Show success
    const notification = document.createElement("div");
    notification.textContent = "✓ Route optimized for efficiency";
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  } catch (error) {
    console.error("Route optimization error:", error);
    alert(`Optimization failed: ${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function handleClearOrder() {
  if (!state.orderJobsContext) return;

  // Reset to original order
  state.orderJobsContext.entries.sort((a, b) => a._originalIndex - b._originalIndex);
  state.orderJobsContext.optimizedOrder = state.orderJobsContext.entries.map((e) => e.quote.id);

  // Re-render the route with original order
  drawRoutePath();

  const notification = document.createElement("div");
  notification.textContent = "↻ Order reset to original";
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #2196f3;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    z-index: 10000;
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2000);
}

async function handleSaveJobOrder() {
  if (!state.orderJobsContext) return;

  const { dateKey, entries, startLocation, finishLocation } = state.orderJobsContext;
  const btn = elements.saveJobOrder;
  const originalText = btn ? btn.textContent : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "💾 Saving...";
  }

  try {
    // Build dayOrders object for all entries
    const dayOrders = {};
    entries.forEach((entry, index) => {
      dayOrders[entry.quote.id] = index;
    });

    // Update each quote's dayOrders field in Firestore
    const updates = entries.map((entry) => {
      const newDayOrders = entry.quote.dayOrders || {};
      newDayOrders[dateKey] = dayOrders[entry.quote.id];
      
      // Also save route start/finish locations if they exist
      const updateData = {
        dayOrders: newDayOrders,
      };
      
      // Save route locations at the quote level
      if (startLocation) {
        updateData.routeStartLocation = startLocation;
      }
      if (finishLocation) {
        updateData.routeFinishLocation = finishLocation;
      }
      
      return updateDoc(doc(db, "quotes", entry.quote.id), updateData);
    });

    await Promise.all(updates);

    // Update local state
    entries.forEach((entry, index) => {
      const quote = state.quotes.find((q) => q.id === entry.quote.id);
      if (quote) {
        if (!quote.dayOrders) quote.dayOrders = {};
        quote.dayOrders[dateKey] = index;
        if (startLocation) quote.routeStartLocation = startLocation;
        if (finishLocation) quote.routeFinishLocation = finishLocation;
      }
    });

    // Show success
    const notification = document.createElement("div");
    notification.textContent = "✓ Job order & route locations saved";
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);

    // Close modal
    closeOrderJobsModal();

    // Refresh schedule
    refreshData();
  } catch (error) {
    console.error("Failed to save job order", error);
    alert(`Failed to save: ${error.message || "Unknown error"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function handleDeleteSelectedJobs(dateKey) {
  // Get only SELECTED jobs for this date
  const isoKey = dateKey;
  const entries = (state.quotes || [])
    .filter((quote) => !quote.deleted && quote.bookedDate && state.selectedJobIds.has(quote.id))
    .flatMap((quote) => {
      const cleans = getOccurrences(quote, state.startDate, state.weeksVisible);
      return cleans
        .filter((clean) => {
          const cleanDateStr = clean.toISOString().split("T")[0];
          return cleanDateStr === isoKey;
        })
        .map((clean, idx) => ({
          quote,
          cleanIndex: idx,
          _originalIndex: state.quotes.indexOf(quote),
        }));
    });

  if (entries.length === 0) {
    alert("No jobs selected for deletion on this day");
    return;
  }

  // Show confirmation dialog with list of jobs to delete
  const jobsList = entries
    .map((e) => `${escapeHtml(e.quote.customerName)} - £${e.quote.pricePerClean}`)
    .join("\n");

  const confirmed = await new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 500px;
      text-align: center;
    `;
    
    const title = document.createElement('h3');
    title.textContent = `Delete ${entries.length} job${entries.length !== 1 ? 's' : ''}?`;
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; color: #333;';
    
    const message = document.createElement('p');
    message.textContent = 'This action cannot be undone.';
    message.style.cssText = 'margin: 0 0 16px 0; font-size: 14px; color: #666;';
    
    const jobsContainer = document.createElement('div');
    jobsContainer.style.cssText = `
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px;
      text-align: left;
      max-height: 300px;
      overflow-y: auto;
      margin-bottom: 16px;
      font-size: 14px;
      color: #333;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    jobsContainer.textContent = jobsList;
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.cssText = `
      background: #dc3545;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    deleteBtn.onmouseover = () => deleteBtn.style.background = '#c82333';
    deleteBtn.onmouseout = () => deleteBtn.style.background = '#dc3545';
    deleteBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(true);
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: #e2e6eb;
      color: #333;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    cancelBtn.onmouseover = () => cancelBtn.style.background = '#d1d5db';
    cancelBtn.onmouseout = () => cancelBtn.style.background = '#e2e6eb';
    cancelBtn.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    buttonContainer.appendChild(deleteBtn);
    buttonContainer.appendChild(cancelBtn);
    
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(jobsContainer);
    dialog.appendChild(buttonContainer);
    
    // Overlay to dim background
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
    `;
    overlay.onclick = () => {
      dialog.remove();
      overlay.remove();
      resolve(false);
    };
    
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
    deleteBtn.focus();
  });

  if (!confirmed) {
    return;
  }

  // Delete each quote
  try {
    for (const entry of entries) {
      const quote = entry.quote;
      await updateDoc(doc(db, "quotes", quote.id), {
        deleted: true,
      });
    }
    
    // Refresh data
    state.quotes = await fetchBookedQuotes();
    renderSchedule();
    alert(`${entries.length} job${entries.length !== 1 ? 's' : ''} deleted successfully`);
  } catch (err) {
    console.error("Error deleting jobs:", err);
    alert("Error deleting jobs: " + (err.message || err));
  }
}

function closeOrderJobsModal() {
  if (elements.orderJobsModal) {
    elements.orderJobsModal.hidden = true;
  }
  
  // Clean up map resources
  if (state.orderJobsContext) {
    // Remove all markers from map
    if (state.orderJobsContext.markers) {
      state.orderJobsContext.markers.forEach((marker) => {
        marker.setMap(null);
      });
      state.orderJobsContext.markers = [];
    }
    
    // Remove polyline from map
    if (state.orderJobsContext.polyline) {
      state.orderJobsContext.polyline.setMap(null);
      state.orderJobsContext.polyline = null;
    }
    
    // Clear map reference
    if (state.orderJobsContext.map) {
      state.orderJobsContext.map = null;
    }
  }
  
  state.orderJobsContext = null;
}

function updateDayMessageSendState() {
  if (!elements.sendDayMessage || !elements.dayMessageBody) return;
  const hasBody = (elements.dayMessageBody.value || "").trim().length > 0;
  elements.sendDayMessage.disabled = !hasBody;
}

async function handleSendDayMessage() {
  if (!state.messageContext) return;
  const { entries } = state.messageContext;
  const body = elements.dayMessageBody?.value?.trim();
  if (!body) {
    alert("Enter a message before sending.");
    return;
  }
  if (!window.emailjs || typeof emailjs.send !== "function") {
    alert("EmailJS not loaded. Cannot send messages.");
    return;
  }
  // Determine send mode
  const modeInput = (elements.dayMessageModeRadios() || []).find(r => r.checked);
  const sendMode = modeInput ? modeInput.value : 'email';
  
  // Get the selected template name
  const templateSelect = elements.dayMessageTemplate;
  const selectedOption = templateSelect?.options[templateSelect.selectedIndex];
  const templateTitle = selectedOption?.text || "Message from Swash";
  
  const button = elements.sendDayMessage;
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Sending...";
  }
  
  let sent = 0;
  const total = entries.length;
  const errors = [];
  
  if (elements.dayMessageProgress) {
    elements.dayMessageProgress.textContent = `Sent 0 of ${total}`;
  }
  
  for (const { quote } of entries) {
    const recipientEmail = quote.email || quote.customerEmail;
    const message = body.replace(/\[NAME\]/gi, quote.customerName || "Customer");
    try {
      // Send per selected mode
      let emailSuccess = false;
      let smsSuccess = false;

      // Email path (if selected)
      if (sendMode === 'email' || sendMode === 'both') {
        if (!recipientEmail) {
          errors.push(`${quote.customerName || 'Unknown'}: No email address`);
        } else {
          await emailjs.send(EMAIL_SERVICE, EMAIL_TEMPLATE, {
            title: templateTitle,
            name: quote.customerName || "",
            message: message,
            email: recipientEmail,
          });
          emailSuccess = true;
          await updateDoc(doc(db, "quotes", quote.id), {
            emailLog: arrayUnion({
              type: "message",
              subject: templateTitle,
              sentAt: Date.now(),
              sentTo: recipientEmail,
              success: true,
              body: message,
              sentBy: (function(){
                const u = auth?.currentUser || null;
                return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "rep-scheduler" };
              })(),
            })
          });
        }
      }

      // SMS path (if selected)
      if (sendMode === 'sms' || sendMode === 'both') {
        const mobileRaw = quote.mobile || quote.phone || quote.contactNumber;
        const to = normalizeUkPhone(mobileRaw);
        if (!to) {
          errors.push(`${quote.customerName || 'Unknown'}: No valid mobile number`);
        } else {
          // Attempt SMS via relative API first; if 404 (not found on current host), retry against fallback Vercel domain.
          const SMS_RELATIVE_ENDPOINT = '/api/send-sms';
          const SMS_FALLBACK_ORIGIN = 'https://swash-m0xrn9nb0-christopher-wessells-projects.vercel.app'; // Updated to latest production alias
          async function sendSmsWithFallback(payload) {
            let resp = await fetch(SMS_RELATIVE_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (resp.status === 404) {
              // Likely running on a host (e.g. Firebase) that doesn't serve the Vercel function. Try fallback origin.
              try {
                resp = await fetch(`${SMS_FALLBACK_ORIGIN}${SMS_RELATIVE_ENDPOINT}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
              } catch (fallbackErr) {
                throw new Error(`SMS fallback fetch error: ${fallbackErr.message || 'Unknown'}`);
              }
            }
            return resp;
          }
          const resp = await sendSmsWithFallback({ to, message });
          if (!resp.ok) throw new Error(`SMS failed (${resp.status})`);
          smsSuccess = true;
          await updateDoc(doc(db, "quotes", quote.id), {
            emailLog: arrayUnion({
              type: "sms",
              subject: templateTitle,
              sentAt: Date.now(),
              sentTo: to,
              success: true,
              body: message,
              sentBy: (function(){
                const u = auth?.currentUser || null;
                return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "rep-scheduler" };
              })(),
            })
          });
        }
      }

      // Count as sent if at least one channel succeeded
      if ((sendMode === 'email' && emailSuccess) || (sendMode === 'sms' && smsSuccess) || (sendMode === 'both' && (emailSuccess || smsSuccess))) {
        sent += 1;
        if (elements.dayMessageProgress) {
          elements.dayMessageProgress.textContent = `Sent ${sent} of ${total}`;
        }
      }
    } catch (error) {
      console.error("Failed to send day message", quote.id, error);
      
      // Log failed attempt for the intended channel(s)
      try {
        const failureEntry = (channel, target) => ({
          type: channel === 'sms' ? 'sms' : 'message',
          subject: templateTitle,
          sentAt: Date.now(),
          sentTo: target || (channel === 'sms' ? (normalizeUkPhone(quote.mobile || quote.phone || quote.contactNumber) || 'unknown') : (recipientEmail || 'unknown')),
          success: false,
          error: error?.message || 'Send failed',
          body: message,
          sentBy: (function(){
            const u = auth?.currentUser || null;
            return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: 'rep-scheduler' };
          })(),
        });

        const updates = [];
        if (sendMode === 'email' || sendMode === 'both') {
          updates.push(failureEntry('email', recipientEmail));
        }
        if (sendMode === 'sms' || sendMode === 'both') {
          updates.push(failureEntry('sms'));
        }
        await updateDoc(doc(db, 'quotes', quote.id), { emailLog: arrayUnion(...updates) });
      } catch (logError) {
        console.warn('Failed to log send failure(s)', logError);
      }
      errors.push(`${quote.customerName || 'Unknown'}: ${error.message || 'Send failed'}`);
    }
  }
  
  // Show final status
  if (elements.dayMessageProgress) {
    elements.dayMessageProgress.textContent = sent === total ? "All sent!" : `Sent ${sent} of ${total}`;
  }
  
  // Show errors if any
  if (errors.length && elements.dayMessageErrors) {
    elements.dayMessageErrors.innerHTML = `<strong>Errors:</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
    elements.dayMessageErrors.hidden = false;
  }
  
  if (button) {
    button.disabled = false;
    button.textContent = originalText;
  }
  
  // Pause for 3 seconds to show result, then close
  setTimeout(() => {
    closeDayMessageModal();
  }, 3000);
}

function initEmailJsScheduler() {
  if (window.emailjs && typeof emailjs.init === "function") {
    emailjs.init(EMAIL_PUBLIC_KEY);
  }
}

function attachEvents() {
  elements.generate?.addEventListener("click", () => {
    const rawValue = elements.startWeek?.value || new Date().toISOString().slice(0, 10);
    state.startDate = normalizeStartDate(new Date(rawValue));
    renderSchedule();
  });

  elements.viewToday?.addEventListener("click", () => {
    // Set to current week (Monday of this week)
    const today = new Date();
    state.startDate = normalizeStartDate(today);
    state.weeksVisible = 1; // Show only current week
    // If it's Saturday today, auto-enable Saturday so "today" is visible
    if (today.getDay() === 6) {
      state.includeSaturday = true;
      try { localStorage.setItem("swashShowSaturday", "1"); } catch (_) {}
      if (elements.toggleSaturday) {
        elements.toggleSaturday.textContent = "📆 Hide Saturday";
        elements.toggleSaturday.setAttribute("aria-pressed", "true");
      }
    }
    if (elements.startWeek) {
      elements.startWeek.value = state.startDate.toISOString().slice(0, 10);
    }
    renderSchedule();
    // Auto-scroll to today's row and briefly highlight it
    try {
      const todayIso = toIsoDate(today);
      setTimeout(() => {
        const row = document.querySelector(`.schedule-row[data-date="${todayIso}"]`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
          const prevBg = row.style.backgroundColor;
          row.style.transition = "background-color 0.6s ease";
          row.style.backgroundColor = "#fff9c4"; // soft highlight
          setTimeout(() => { row.style.backgroundColor = prevBg || ""; }, 1800);
        }
      }, 50);
    } catch (_) {}
    updateShowNextWeekButton();
  });

  // Saturday toggle
  elements.toggleSaturday?.addEventListener("click", () => {
    state.includeSaturday = !state.includeSaturday;
    try {
      localStorage.setItem("swashShowSaturday", state.includeSaturday ? "1" : "0");
    } catch (e) {
      console.warn("Failed to persist Saturday toggle", e);
    }
    // Update button labeling/state
    if (elements.toggleSaturday) {
      elements.toggleSaturday.textContent = state.includeSaturday ? "📆 Hide Saturday" : "📆 Show Saturday";
      elements.toggleSaturday.setAttribute("aria-pressed", state.includeSaturday ? "true" : "false");
    }
    renderSchedule();
  });

  elements.search?.addEventListener("input", (event) => {
    state.searchTerm = event.target.value || "";
    applySearchHighlight();
  });

  elements.showPreviousWeek?.addEventListener("click", () => {
    state.startDate = addDays(state.startDate, -7);
    if (elements.startWeek) {
      elements.startWeek.value = state.startDate.toISOString().slice(0, 10);
    }
    renderSchedule();
  });

  elements.showNextWeek?.addEventListener("click", () => {
    if (state.weeksVisible >= MAX_WEEKS) return;
    state.weeksVisible += 1;
    renderSchedule();
    updateShowNextWeekButton();
  });

  elements.logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out failed", error);
    }
  });

  if (elements.schedule) {
    elements.schedule.addEventListener("dragstart", (event) => {
      // If starting drag from a checkbox or select areas, ignore
      if (event.target.closest('.job-select') || event.target.closest('.day-select-wrap')) return;
      const job = event.target.closest(".schedule-job");
      if (!job) return;
      const originDate = job.dataset.date || null;
      // If this job is selected, drag all selected jobs from the same day
      if (state.selectedJobIds.has(job.dataset.id)) {
        const row = job.closest('.schedule-row');
        const idsInThisRow = Array.from(row.querySelectorAll('.schedule-job')).map(el => el.dataset.id);
        state.draggingIds = idsInThisRow.filter(id => state.selectedJobIds.has(id));
      } else {
        state.draggingIds = [job.dataset.id];
      }
      state.dragOriginDate = originDate;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", job.dataset.id);
      // Add dragging class to all dragged cards for visual feedback
      state.draggingIds.forEach((id) => {
        const card = elements.schedule.querySelector(`.schedule-job[data-id="${id}"]`);
        if (card) card.classList.add("dragging");
      });
    });

    elements.schedule.addEventListener("dragend", (event) => {
      // Remove dragging class from any cards
      elements.schedule.querySelectorAll('.schedule-job.dragging').forEach(el => el.classList.remove('dragging'));
      state.draggingIds = [];
      state.dragOriginDate = null;
      state.dragTargetJobId = null;
      // Clean up any remaining insertion lines
      document.querySelectorAll(".insertion-line").forEach(line => line.remove());
    });

    // Prevent drag when interacting with checkboxes or day header controls
    elements.schedule.addEventListener('mousedown', (event) => {
      const card = event.target.closest('.schedule-job');
      if (!card) return;
      // Disable drag if clicking on checkbox or day header controls
      if (event.target.closest('.job-select') || event.target.closest('.day-select-wrap')) {
        card.draggable = false;
      } else {
        card.draggable = true;
      }
    });
    elements.schedule.addEventListener('mouseup', (event) => {
      const card = event.target.closest('.schedule-job');
      if (card) card.draggable = true;
    });

    elements.schedule.addEventListener("dragover", (event) => {
      const row = event.target.closest(".schedule-row");
      if (!row || !state.draggingIds.length) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      
      // Get mouse position relative to the row
      const rowRect = row.getBoundingClientRect();
      const mouseY = event.clientY - rowRect.top;
      
      // Find jobs in this row, excluding the dragged one
      const draggingSet = new Set(state.draggingIds);
      const jobs = Array.from(row.querySelectorAll(".schedule-job")).filter(
        (job) => !draggingSet.has(job.dataset.id)
      );
      
      if (jobs.length === 0) return;
      
      // Remove all existing insertion lines
      row.querySelectorAll(".insertion-line").forEach(line => line.remove());
      
      // Find where to show insertion line based on mouse Y position
      let insertBeforeJob = null;
      let targetJobId = null;
      for (const job of jobs) {
        const jobRect = job.getBoundingClientRect();
        const jobTop = jobRect.top - rowRect.top;
        
        // If mouse is in upper half of job, insert before it
        if (mouseY < jobTop + jobRect.height / 2) {
          insertBeforeJob = job;
          targetJobId = job.dataset.id;
          break;
        }
      }
      
      // Store the target so drop handler uses the same one
      state.dragTargetJobId = targetJobId;
      
      // Create and show insertion line
      const insertLine = document.createElement("div");
      insertLine.className = "insertion-line";
      
      if (insertBeforeJob) {
        // Insert line before target job
        insertBeforeJob.parentNode.insertBefore(insertLine, insertBeforeJob);
      } else if (jobs.length > 0) {
        // Insert line at end (after last job)
        jobs[jobs.length - 1].parentNode.insertBefore(insertLine, jobs[jobs.length - 1].nextSibling);
      }
    });

    elements.schedule.addEventListener("dragleave", (event) => {
      // Only remove lines if leaving the entire row
      const row = event.target.closest(".schedule-row");
      if (row && !row.contains(event.relatedTarget)) {
        row.querySelectorAll(".insertion-line").forEach(line => line.remove());
      }
    });

    elements.schedule.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      // Clean up insertion lines
      document.querySelectorAll(".insertion-line").forEach(line => line.remove());
      
      const row = event.target.closest(".schedule-row");
      if (!row || !state.draggingIds.length) return;
      
  const dateKey = row.dataset.date;
  const draggedIds = state.draggingIds.slice();
      const targetJobId = state.dragTargetJobId; // Use the target from dragover
      state.dragTargetJobId = null; // Clear it
      
  console.log("DROP EVENT - dateKey:", dateKey, "draggedIds:", draggedIds.join(","), "dragOriginDate:", state.dragOriginDate, "targetJobId:", targetJobId);
      
      // If dropping within the same day
      if (state.dragOriginDate && state.dragOriginDate === dateKey) {
        // Only reorder if we found a valid target during dragover
        if (draggedIds.length > 1) {
          const ok = await reorderMultipleWithinDay(dateKey, draggedIds, targetJobId || null);
          if (!ok) {
            console.error("Failed to reorder within day");
          } else {
            console.log("Reorder successful, waiting before re-render...");
            // Give Firestore listener time to update
            await delay(150);
            console.log("Re-rendering after reorder");
          }
        } else if (draggedIds.length === 1) {
          if (targetJobId && targetJobId !== draggedIds[0]) {
            console.log("Calling reorderWithinDay with stored target:", dateKey, draggedIds[0], targetJobId);
            const ok = await reorderWithinDay(dateKey, draggedIds[0], targetJobId);
            if (!ok) {
              console.error("Failed to reorder within day");
            } else {
              console.log("Reorder successful, waiting before re-render...");
              await delay(150);
              console.log("Re-rendering after reorder");
            }
          } else {
            console.log("No stored target or dropping at end");
          }
        }
        
        renderSchedule();
        return;
      }
      
      // Dropping to a different day - reschedule
      const targetDate = new Date(`${dateKey}T00:00:00`);
      const success = draggedIds.length > 1
        ? await rescheduleQuotes(draggedIds, targetDate)
        : await rescheduleQuote(draggedIds[0], targetDate);
      if (success) {
        renderSchedule();
      } else {
        console.error("Failed to reschedule quote");
      }
    });

    elements.schedule.addEventListener("click", (event) => {
      // Check if clicking the "Mark as done" button
      const markDoneBtn = event.target.closest(".job-mark-done");
      if (markDoneBtn) {
        event.stopPropagation();
        const quoteId = markDoneBtn.dataset.quoteId;
        if (quoteId) {
          handleMarkJobDone(quoteId);
        }
        return;
      }
      
      // Check if clicking the completed status box to undo
      const completedStatus = event.target.closest(".job-status-completed");
      if (completedStatus) {
        event.stopPropagation();
        const quoteId = completedStatus.dataset.quoteId;
        if (quoteId) {
          handleUndoCompletion(quoteId);
        }
        return;
      }
      
      // Check if clicking the label or custom box (including checkbox area)
      const selectLabel = event.target.closest(".job-select");
      if (selectLabel) {
        // Stop propagation to prevent expand/collapse
        event.stopPropagation();
        const card = event.target.closest(".schedule-job");
        const checkbox = selectLabel.querySelector("input[type=checkbox]");
        const id = card?.dataset.id;
        if (id && checkbox) {
          // Toggle checkbox state
          checkbox.checked = !checkbox.checked;
          // Update selection state
          if (checkbox.checked) {
            state.selectedJobIds.add(id);
          } else {
            state.selectedJobIds.delete(id);
          }
          updateSelectionUI();
        }
        return;
      }
      
      // Expand/collapse details on card click (but not on checkbox area)
      const job = event.target.closest(".schedule-job");
      if (job) {
        const details = job.querySelector(".schedule-job__details");
        if (details) {
          const isHidden = details.hasAttribute("hidden");
          if (isHidden) {
            details.removeAttribute("hidden");
            job.classList.add("expanded");
          } else {
            details.setAttribute("hidden", "");
            job.classList.remove("expanded");
          }
        }
        return;
      }
    });

    // Day actions: open modal on selection + day select all checkbox
    elements.schedule.addEventListener("change", (event) => {
      console.log("Change event:", event.target.tagName, event.target.className, "Value:", event.target.value);
      
      // Check if it's the day actions select
      if (event.target.tagName === "SELECT" && event.target.classList.contains("day-actions-select")) {
        const action = event.target.value;
        const dateKey = event.target.dataset.date;
        
        if (action === "order" && dateKey) {
          openOrderJobsModal(dateKey);
          // Reset dropdown after modal opens
          setTimeout(() => { event.target.value = ""; }, 100);
        } else if (action === "send" && dateKey) {
          openDayMessageModal(dateKey);
          // Reset dropdown after modal opens
          setTimeout(() => { event.target.value = ""; }, 100);
        } else if (action === "delete" && dateKey) {
          handleDeleteSelectedJobs(dateKey);
          // Reset dropdown after action
          setTimeout(() => { event.target.value = ""; }, 100);
        }
        return;
      }
      
      // Check if it's the day select-all checkbox
      if (event.target.tagName === "INPUT" && event.target.classList.contains("day-select-all")) {
        const dayCard = event.target.closest('.schedule-row');
        const ids = Array.from(dayCard.querySelectorAll('.schedule-job')).map((el) => el.dataset.id);
        if (event.target.checked) {
          ids.forEach((id) => state.selectedJobIds.add(id));
        } else {
          ids.forEach((id) => state.selectedJobIds.delete(id));
        }
        updateSelectionUI();
        return;
      }
    });
  }

  elements.dayMessageCancel?.addEventListener("click", closeDayMessageModal);
  elements.closeDayMessageModal?.addEventListener("click", closeDayMessageModal);
  elements.sendDayMessage?.addEventListener("click", handleSendDayMessage);
  elements.dayMessageTemplate?.addEventListener("change", applyTemplateToBody);
  elements.dayMessageBody?.addEventListener("input", updateDayMessageSendState);
  elements.saveTemplate?.addEventListener("click", saveNewTemplate);
  elements.deleteTemplate?.addEventListener("click", deleteTemplate);

  // Order jobs modal listeners
  elements.closeOrderJobsModal?.addEventListener("click", closeOrderJobsModal);
  elements.cancelOrderJobs?.addEventListener("click", closeOrderJobsModal);
  elements.optimizeRouteBtn?.addEventListener("click", handleOptimizeRoute);
  elements.clearOrderBtn?.addEventListener("click", handleClearOrder);
  elements.saveJobOrder?.addEventListener("click", handleSaveJobOrder);

  // Selection info listeners
  elements.clearSelectionBtn?.addEventListener("click", clearSelectedJobs);

  elements.cleanerFilter?.addEventListener("change", (event) => {
    state.cleanerFilter = event.target.value;
    renderSchedule();
  });

  elements.closeModal?.addEventListener("click", () => {
    if (elements.emailModal) {
      elements.emailModal.hidden = true;
    }
  });
}

export async function startSchedulerApp() {
  if (schedulerInitialised) return;
  schedulerInitialised = true;

  await waitForDomReady();
  console.log('[Scheduler] DOM ready');
  initMenuDropdown();
  initEmailJsScheduler();
  loadCustomTemplates();

  // Set up area management
  const user = auth.currentUser;
  if (user) {
    state.currentUserId = user.uid;
    await loadAreas();
    initAreasModal();
  }

  const baseline = new Date(`${BASELINE_START_DATE}T00:00:00`);
  state.startDate = normalizeStartDate(baseline);

  if (elements.startWeek) {
    elements.startWeek.value = BASELINE_START_DATE;
  }

  console.time('[Scheduler] initial-data');
  state.quotes = await fetchBookedQuotes();
  state.weeksVisible = INITIAL_WEEKS;
  state.draggingIds = [];
  clearSelectedJobs();

  // Load Saturday preference
  try {
    const saved = localStorage.getItem("swashShowSaturday");
    state.includeSaturday = saved === "1";
  } catch (_) {
    state.includeSaturday = false;
  }

  // Reflect Saturday button state
  if (elements.toggleSaturday) {
    elements.toggleSaturday.textContent = state.includeSaturday ? "📆 Hide Saturday" : "📆 Show Saturday";
    elements.toggleSaturday.setAttribute("aria-pressed", state.includeSaturday ? "true" : "false");
  }

  if (elements.cleanerFilter) {
    populateCleanerSelect(elements.cleanerFilter, {
      includePlaceholder: true,
      placeholderLabel: "All cleaners",
      includeAll: true,
      includeUnassigned: true,
    });
  }

  console.time('[Scheduler] renderSchedule');
  renderSchedule();
  console.timeEnd('[Scheduler] renderSchedule');
  attachEvents();
  updateSelectionUI();
  updateShowNextWeekButton();
  console.timeEnd('[Scheduler] initial-data');
}

if (syncChannel) {
  syncChannel.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "quotes-updated" && data.source !== SYNC_SOURCE) {
      if (syncReloadInProgress) return;
      syncReloadInProgress = true;
      refreshData()
        .catch((error) => console.error("Sync reload failed", error))
        .finally(() => {
          syncReloadInProgress = false;
        });
    }
  });
}

function setupSchedulerAuth() {
  if (!elements.loginForm) return;
  
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearLoginError();
    
    const email = elements.loginEmail?.value.trim();
    const password = elements.loginPassword?.value;
    
    if (!email || !password) {
      setLoginError("Please enter your email and password.");
      return;
    }
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      clearLoginError();
    } catch (error) {
      console.error("Login failed", error);
      if (error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        setLoginError("Invalid email or password.");
      } else if (error.code === "auth/too-many-requests") {
        setLoginError("Too many failed attempts. Please try again later.");
      } else {
        setLoginError("Sign in failed. Please try again.");
      }
      elements.loginEmail.value = "";
      elements.loginPassword.value = "";
    }
  });

  elements.logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out failed", error);
    }
  });
}

async function initScheduler() {
  await waitForDomReady();
  setupSchedulerAuth();
  
  onAuthStateChanged(auth, (user) => {
    if (user) {
      clearLoginError();
      elements.logoutBtn?.removeAttribute("hidden");
      showAuthOverlay(false);
      startSchedulerApp().catch((error) => {
        console.error("Scheduler initialisation failed", error);
        setLoginError("Unable to load scheduler data. Please try again.");
        showAuthOverlay(true);
      });
    } else {
      clearLoginError();
      elements.logoutBtn?.setAttribute("hidden", "hidden");
      showAuthOverlay(true);
      elements.loginEmail?.focus();
    }
  });
}

async function bootstrapSchedulerPage() {
  await authStateReady();
  console.log("[Page] Auth ready, userRole:", window.userRole);
  const routing = await handlePageRouting("shared");
  if (routing.redirected) return;
  console.log("[Scheduler] Auth OK");
  await delay(100);
  await initScheduler();
}

bootstrapSchedulerPage();

// Helpers
function getCycleWeekNumber(weekStart) {
  const baseline = new Date(`${BASELINE_START_DATE}T00:00:00`);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diffWeeks = Math.floor((weekStart - baseline) / msPerWeek);
  const mod = ((diffWeeks % 4) + 4) % 4;
  return mod + 1;
}

function getPaymentStatusClass(quote) {
  const status = (quote.status || "").toString().toLowerCase();
  const paidFlag = quote.paid === true || /paid/.test(status);
  const repeatFlag = /repeat/.test(status);
  if (paidFlag) return "schedule-job--paid";
  if (repeatFlag && !paidFlag) return "schedule-job--repeat-unpaid";
  return "schedule-job--unpaid";
}

function isJobCompleted(quote) {
  const status = (quote.status || "").toString();
  return status.startsWith("Completed");
}

function getCompletionDisplay(quote) {
  if (!isJobCompleted(quote)) return null;
  const status = quote.status || "Completed";
  return status;
}

function buildJobDetailsHtml(quote) {
  const safe = (v) => escapeHtml(v ?? "—");
  const telRaw = quote.mobile || quote.phone || quote.contactNumber || "";
  const telDisplay = telRaw ? safe(telRaw) : "—";
  const telHref = telRaw ? formatTelHref(telRaw) : null;
  const emailRaw = quote.email || quote.customerEmail || "";
  const emailDisplay = emailRaw ? safe(emailRaw) : "—";
  const emailHref = emailRaw ? `mailto:${encodeURIComponent(String(emailRaw))}` : null;

  // Calculate duration from price (£1 per minute)
  const pricePerClean = resolvePricePerClean(quote);
  const durationMins = Math.round(pricePerClean);
  const durationDisplay = durationMins === 1 ? "1 min" : `${durationMins} mins`;

  const rows = [
    ["Address", safe(quote.address)],
    ["Contact", telHref ? `<a href="${telHref}">${telDisplay}</a>` : telDisplay],
    ["Email", emailHref ? `<a href="${emailHref}">${emailDisplay}</a>` : emailDisplay],
    ["Price", formatCurrency(pricePerClean)],
    ["Est. Duration", `<strong style="color: #0078d7;">${durationDisplay}</strong>`],
    ["House type", safe(quote.houseType || quote.propertyType)],
    ["House size", safe(quote.houseSize || quote.size)],
    ["Extension", safe(quote.extension ? "Yes" : quote.extension === false ? "No" : quote.extension)],
    ["Conservatory", safe(quote.conservatory ? "Yes" : quote.conservatory === false ? "No" : quote.conservatory)],
    ["Roof lights", safe(quote.roofLights || quote.rooflights)],
    ["Alternating clean %", safe(quote.partialPercent || quote.alternatingPercent)],
  ];
  return `
    <dl class="job-details">
      ${rows
        .map(([label, value]) => `
          <div class="job-details__row">
            <dt>${escapeHtml(label)}</dt>
            <dd>${value}</dd>
          </div>
        `)
        .join("")}
    </dl>
    ${getNavigationUrl(quote) ? `
      <div class="job-details__actions">
        <a class="btn btn-primary job-nav-btn" href="${getNavigationUrl(quote)}" target="_blank" rel="noopener nofollow">Navigate</a>
      </div>
    ` : ''}
  `;
}

// Build a navigation URL that opens the default maps app on mobile
function getNavigationUrl(quote) {
  const lat = Number(quote.customerLatitude);
  const lng = Number(quote.customerLongitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const address = (quote.address || '').trim();
  if (!hasCoords && !address) return null;

  const dest = hasCoords ? `${lat},${lng}` : encodeURIComponent(address);
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua);

  // Apple Maps on iOS, Google Maps elsewhere
  if (isiOS) {
    return `http://maps.apple.com/?daddr=${dest}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
