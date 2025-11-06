import { auth, db } from './firebase-init.js';
import { authStateReady, handlePageRouting } from './auth-check.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, deleteDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

await waitForDomReady();
await authStateReady();
console.log("[Page] Auth ready, userRole:", window.userRole);
const routing = await handlePageRouting("rep");
if (routing.redirected) {
  console.log("[Add Log] Redirect scheduled; halting log initialisation");
  await new Promise(() => {});
}
await delay(100);

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

const TEMPLATE_TEXT = `[ROAD NAME] - TIME LOGGED
1 |
2 |
3 |
4 |
5 |
6 |
7 |
8 |
9 |
10 |
11 |
12 |
13 |
14 |
15 |
16 |
17 |
18 |
19 |
20 |
21 |
22 |
23 |
24 |
25 |
26 |
27 |
28 |
29 |
30 |
31 |
32 |
33 |
34 |
35 |
36 |
37 |
38 |
39 |
40 |
41 |
42 |
43 |
44 |
45 |
46 |
47 |
48 |
49 |
50 |
51 |
52 |
53 |
54 |
55 |
56 |
57 |
58 |
59 |
60 |
61 |
62 |
63 |
64 |
65 |
66 |
67 |
68 |
69 |
70 |
71 |
72 |
73 |
74 |
75 |
76 |
77 |
78 |
79 |
80 |
81 |
82 |
83 |
84 |
85 |
86 |
87 |
88 |
89 |
90 |
91 |
92 |
93 |
94 |
95 |
96 |
97 |
98 |
99 |
100 |
101 |
102 |
103 |
104 |
105 |
106 |
107 |
108 |
109 |
110 |
111 |
112 |
113 |
114 |
115 |
116 |
117 |
118 |
119 |
120 |
121 |
122 |
123 |
124 |
125 |
126 |
127 |
128 |
129 |
130 |
131 |
132 |
133 |
134 |
135 |
136 |
137 |
138 |
139 |
140 |
141 |
142 |
143 |
144 |
145 |
146 |
147 |
148 |
149 |
150 |
151 |
152 |
153 |
154 |
155 |
156 |
157 |
158 |
159 |
160 |
161 |
162 |
163 |
164 |
165 |
166 |
167 |
168 |
169 |
170 |
171 |
172 |
173 |
174 |
175 |
176 |
177 |
178 |
179 |
180 |
181 |
182 |
183 |
184 |
185 |
186 |
187 |
188 |
189 |
190 |
191 |
192 |
193 |
194 |
195 |
196 |
197 |
198 |
199 |
200 |
201 |
202 |
203 |
204 |
205 |
206 |
207 |
208 |
209 |
210 |
211 |
212 |
213 |
214 |
215 |
216 |
217 |
218 |
219 |
220 |
221 |
222 |
223 |
224 |
225 |
226 |
227 |
228 |
229 |
230 |
231 |
232 |
233 |
234 |
235 |
236 |
237 |
238 |
239 |
240 |
241 |
242 |
243 |
244 |
245 |
246 |
247 |
248 |
249 |
250 |
251 |
252 |
253 |
254 |
255 |
256 |
257 |
258 |
259 |
260 |
261 |
262 |
263 |
264 |
265 |
266 |
267 |
268 |
269 |
270 |
271 |
272 |
273 |
274 |
275 |
276 |
277 |
278 |
279 |
280 |
281 |
282 |
283 |
284 |
285 |
286 |
287 |
288 |
289 |
290 |
291 |
292 |
293 |
294 |
295 |
296 |
297 |
298 |
299 |
300 |`;

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
