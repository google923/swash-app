import { auth, db } from '../firebase-init.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, deleteDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Track captured location
let capturedLocation = null;

// Elements
const els = {
  btnCopyTemplate: document.getElementById("btnCopyTemplate"),
  logText: document.getElementById("logText"),
  logDate: document.getElementById("logDate"),
  repName: document.getElementById("repName"),
  odometerStart: document.getElementById("odometerStart"),
  odometerEnd: document.getElementById("odometerEnd"),
  btnSubmitLog: document.getElementById("btnSubmitLog"),
  calendar: document.getElementById("calendar"),
  filterRep: document.getElementById("filterRep"),
  logModal: document.getElementById("logModal"),
  logModalContent: document.getElementById("logModalContent"),
  closeLogModal: document.getElementById("closeLogModal"),
  closeLogModalBtn: document.getElementById("closeLogModalBtn"),
  logModalTitle: document.getElementById("logModalTitle"),
  deleteLogBtn: document.getElementById("deleteLogBtn"),
  captureLocation: document.getElementById("captureLocation"),
  locationStatus: document.getElementById("locationStatus"),
  locationCoords: document.getElementById("locationCoords"),
};

// State for current month offset
let currentMonthOffset = 0;
let currentLogId = null;
let isAdmin = false;

// Populate filter dropdown with all reps from Firestore
async function populateRepFilter() {
  try {
    const usersQuery = query(collection(db, "users"));
    const snapshot = await getDocs(usersQuery);
    const reps = snapshot.docs
      .map(doc => doc.data().repName)
      .filter(name => name) // Filter out empty names
      .sort();
    
    // Clear existing options (keep "All reps")
    const filterRep = els.filterRep;
    while (filterRep.options.length > 1) {
      filterRep.remove(1);
    }
    
    // Add rep options
    reps.forEach(rep => {
      const option = document.createElement("option");
      option.value = rep;
      option.textContent = rep;
      filterRep.appendChild(option);
    });
  } catch (err) {
    console.error("Failed to populate rep filter:", err);
  }
}

const TEMPLATE_TEXT = (() => {
  const lines = Array.from({ length: 300 }, (_, index) => `${index + 1} |`);
  return `(Date) (Road Name)\n\n${lines.join("\n")}`;
})();

function copyTemplate() {
  navigator.clipboard.writeText(TEMPLATE_TEXT).then(() => {
    alert("Template copied to clipboard.");
  }).catch(() => alert("Failed to copy. Please copy manually."));
}

function parseOdometers(text) {
  // Look for the two labelled sections; pick first number group after each label
  const startMatch = /Shift\s+start\s+odometer[:\-]?\s*([\d,.]+)/i.exec(text);
  const endMatch = /Shift\s+end\s+odometer[:\-]?\s*([\d,.]+)/i.exec(text);
  const parse = (m) => m ? Number(String(m[1]).replace(/[^\d]/g, "")) : null;
  return { odometerStart: parse(startMatch), odometerEnd: parse(endMatch) };
}

function isoDateOnly(d) {
  const dd = new Date(d);
  dd.setHours(0,0,0,0);
  return dd.toISOString().slice(0,10);
}

// Capture current GPS location
function captureCurrentLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    els.captureLocation.checked = false;
    return;
  }

  els.locationStatus.style.display = "block";
  els.locationCoords.textContent = "Getting location...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      capturedLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      els.locationCoords.textContent = `${capturedLocation.lat.toFixed(4)}, ${capturedLocation.lng.toFixed(4)}`;
      console.log("Location captured:", capturedLocation);
    },
    (error) => {
      console.error("Geolocation error:", error);
      alert(`Failed to get location: ${error.message}`);
      els.captureLocation.checked = false;
      els.locationStatus.style.display = "none";
      capturedLocation = null;
    }
  );
}

async function submitLog() {
  const rep = (els.repName.value || "").trim();
  const text = (els.logText.value || "").trim();
  const dateVal = els.logDate.value;
  if (!rep || !text || !dateVal) {
    alert("Please enter rep name, date, and paste your log.");
    return;
  }
  
  // Get odometer values from input fields
  const odometerStart = els.odometerStart.value ? parseInt(els.odometerStart.value) : null;
  const odometerEnd = els.odometerEnd.value ? parseInt(els.odometerEnd.value) : null;
  
  // Prepare log data
  const logData = {
    rep,
    dateISO: isoDateOnly(dateVal),
    logText: text,
    odometerStart,
    odometerEnd,
    createdAt: serverTimestamp(),
  };

  // Add location if checkbox was checked and location was captured
  if (els.captureLocation.checked && capturedLocation) {
    logData.location = {
      lat: capturedLocation.lat,
      lng: capturedLocation.lng,
    };
  }

  try {
    await addDoc(collection(db, "repLogs"), logData);
    alert("Log submitted.");
    els.logText.value = "";
    els.odometerStart.value = "";
    els.odometerEnd.value = "";
    els.captureLocation.checked = false;
    capturedLocation = null;
    els.locationStatus.style.display = "none";
    await loadCalendar();
  } catch (err) {
    console.error("Failed to save log", err);
    alert("Failed to save log.");
  }
}

function startOfMonth(d){ const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d){ const x=new Date(d); x.setMonth(x.getMonth()+1); x.setDate(0); x.setHours(23,59,59,999); return x; }

async function loadCalendar() {
  if (!els.calendar) return;
  const today = new Date();
  today.setMonth(today.getMonth() + currentMonthOffset);
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const startISO = start.toISOString().slice(0,10);
  const endISO = end.toISOString().slice(0,10);

  const constraints = [where("dateISO", ">=", startISO), where("dateISO", "<=", endISO)];
  const q = query(collection(db, "repLogs"), ...constraints, orderBy("dateISO"));
  const snap = await getDocs(q);

  // Build map date -> logs
  const byDate = new Map();
  const reps = new Set(["ALL"]);
  snap.forEach((doc)=>{
    const data = doc.data();
    reps.add(data.rep || "Unknown");
    if (!byDate.has(data.dateISO)) byDate.set(data.dateISO, []);
    byDate.get(data.dateISO).push({ id: doc.id, ...data });
  });

  // Filter already populated in HTML with static list

  // Render current month grid
  els.calendar.innerHTML = "";
  const firstDow = start.getDay(); // 0 Sun..6 Sat
  const pad = (firstDow + 6) % 7; // convert to Mon=0
  for (let i=0;i<pad;i++){ const d = document.createElement("div"); d.className = "rep-day empty"; els.calendar.appendChild(d); }
  const daysInMonth = end.getDate();
  for (let day=1; day<=daysInMonth; day++){
    const d = new Date(start); d.setDate(day);
    const iso = d.toISOString().slice(0,10);
    const cell = document.createElement("div");
    cell.className = "rep-day";
    cell.dataset.date = iso;
    const logs = byDate.get(iso) || [];
    const selRep = els.filterRep?.value || "ALL";
    const filtered = selRep === "ALL" ? logs : logs.filter(l => l.rep === selRep);
    
    // Build badges HTML
    let badgesHtml = '';
    if (filtered.length) {
      // Group by rep and show one badge per rep
      const repGroups = new Map();
      filtered.forEach(log => {
        const name = log.rep || "Unknown";
        if (!repGroups.has(name)) repGroups.set(name, []);
        repGroups.get(name).push(log);
      });
      badgesHtml = Array.from(repGroups.entries()).map(([name, logs]) => 
        `<div class="rep-badge" data-date="${iso}" data-rep="${name}">${name}</div>`
      ).join('');
    }
    
    cell.innerHTML = `<div class="rep-day__date">${iso}</div><div class="rep-day__badges">${badgesHtml}</div>`;
    
    // Add click handler to badges
    if (filtered.length) {
      cell.querySelectorAll('.rep-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          const repName = badge.dataset.rep;
          const repLogs = filtered.filter(l => (l.rep || "Unknown") === repName);
          // Show only the first log for this rep on this day
          if (repLogs.length > 0) {
            openLogModal(repLogs[0]);
          }
        });
      });
    }
    els.calendar.appendChild(cell);
  }
}

function openLogModal(log) {
  if (!els.logModal) return;
  const repName = log.rep || "Unknown";
  const start = log.odometerStart != null ? log.odometerStart : "—";
  const end = log.odometerEnd != null ? log.odometerEnd : "—";
  els.logModalTitle.textContent = `Log - ${repName}`;
  els.logModalContent.textContent = log.logText || "(No log content)";
  currentLogId = log.id || null;
  // Toggle delete button based on admin role
  if (els.deleteLogBtn) {
    if (isAdmin && currentLogId) {
      els.deleteLogBtn.classList.remove("hidden");
      els.deleteLogBtn.disabled = false;
    } else {
      els.deleteLogBtn.classList.add("hidden");
      els.deleteLogBtn.disabled = true;
    }
  }
  els.logModal.removeAttribute('hidden');
}

function closeLogModal() {
  els.logModal?.setAttribute('hidden', '');
}

function setMonthTab(offset) {
  currentMonthOffset = offset;
  document.querySelectorAll('.month-tab').forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.offset) === offset);
  });
  loadCalendar();
}

function init() {
  const todayISO = new Date().toISOString().slice(0,10);
  if (els.logDate) els.logDate.value = todayISO;
  els.btnCopyTemplate?.addEventListener('click', copyTemplate);
  els.btnSubmitLog?.addEventListener('click', submitLog);
  els.closeLogModal?.addEventListener('click', closeLogModal);
  els.closeLogModalBtn?.addEventListener('click', closeLogModal);
  els.deleteLogBtn?.addEventListener('click', handleDeleteLog);
  els.filterRep?.addEventListener('change', loadCalendar);

  // Location capture handler
  els.captureLocation?.addEventListener('change', (e) => {
    if (e.target.checked) {
      captureCurrentLocation();
    } else {
      capturedLocation = null;
      els.locationStatus.style.display = "none";
    }
  });
  
  // Month tab navigation
  document.querySelectorAll('.month-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setMonthTab(parseInt(tab.dataset.offset));
    });
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return; // auth-check.js will show login overlay if needed
  try {
    // Get user profile data
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const userData = snap.data();
      const role = userData.role || "rep";
      isAdmin = role === "admin";
      // Populate rep name field with user's repName from Firebase
      if (userData.repName && els.repName) {
        els.repName.value = userData.repName;
      }
      // Populate dropdown with all reps
      await populateRepFilter();
      // Prefill the filter dropdown with current user's name
      if (userData.repName && els.filterRep) {
        els.filterRep.value = userData.repName;
      }
    } else {
      isAdmin = false;
    }
  } catch (e) {
    console.warn("Failed to fetch user data; defaulting to rep.", e);
    isAdmin = false;
  }
  init();
  await loadCalendar();
});

async function handleDeleteLog() {
  if (!currentLogId) return;
  const confirmed = window.confirm("Are you sure you want to delete this log? This action cannot be undone.");
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "repLogs", currentLogId));
    currentLogId = null;
    closeLogModal();
    await loadCalendar();
    alert("Log deleted.");
  } catch (err) {
    console.error("Failed to delete log", err);
    alert("Failed to delete log. Please try again.");
  }
}
