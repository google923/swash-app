import { auth, db } from '../firebase-init.js';
import { authStateReady, handlePageRouting } from '../auth-check.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, limit, where, deleteDoc, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// State
const state = {
  currentUser: null,
  repName: "Rep",
  isAdmin: false,
  reps: [],
  monthEvents: new Map(), // key = YYYY-MM-DD -> [events]
  currentEvent: null,
  payPeriodOffset: 0,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

// Motivational quotes
const quotes = [
  {
    text: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    author: "Winston Churchill",
  },
  {
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
  },
  {
    text: "Believe you can and you're halfway there.",
    author: "Theodore Roosevelt",
  },
  {
    text: "Don't watch the clock; do what it does. Keep going.",
    author: "Sam Levenson",
  },
  {
    text: "The harder you work for something, the greater you'll feel when you achieve it.",
    author: "Unknown",
  },
  {
    text: "Success doesn't just find you. You have to go out and get it.",
    author: "Unknown",
  },
  {
    text: "Dream bigger. Do bigger.",
    author: "Unknown",
  },
  {
    text: "Great things never come from comfort zones.",
    author: "Unknown",
  },
  {
    text: "Push yourself, because no one else is going to do it for you.",
    author: "Unknown",
  },
  {
    text: "The secret of getting ahead is getting started.",
    author: "Mark Twain",
  },
];

// DOM elements
const repNameDisplay = document.getElementById("repNameDisplay");
const currentDateEl = document.getElementById("currentDate");
const weeklySignupsEl = document.getElementById("weeklySignups");
const weeklyTrendEl = document.getElementById("weeklyTrend");
const monthlyMileageEl = document.getElementById("monthlyMileage");
const mileageTrendEl = document.getElementById("mileageTrend");
const avgDailySignupsEl = document.getElementById("avgDailySignups");
const avgTrendEl = document.getElementById("avgTrend");
const announcementsListEl = document.getElementById("announcementsList");
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
// Performance period navigation elements (added for previous period view)
const prevPeriodBtn = document.getElementById("prevPeriodBtn");
const periodLabelEl = document.getElementById("periodLabel");

// Calendar elements (minimal calendar on Rep Home)
const calEls = {
  calendar: document.getElementById("calendar"),
  calendarMonth: document.getElementById("calendarMonth"),
  logModal: document.getElementById("logModal"),
  logModalContent: document.getElementById("logModalContent"),
  logModalTitle: document.getElementById("logModalTitle"),
  closeLogModalBtn: document.getElementById("closeLogModalBtn"),
  deleteLogBtn: document.getElementById("deleteLogBtn"),
  prevBtn: document.getElementById("prevMonth"),
  nextBtn: document.getElementById("nextMonth"),
};

// Event UI elements
const eventUI = {
  tools: document.getElementById("adminEventTools"),
  form: document.getElementById("eventForm"),
  title: document.getElementById("eventTitle"),
  date: document.getElementById("eventDate"),
  time: document.getElementById("eventTime"),
  desc: document.getElementById("eventDesc"),
  assignees: document.getElementById("eventAssignees"),
  createBtn: document.getElementById("createEventBtn"),
  // modal
  modal: document.getElementById("eventModal"),
  modalTitle: document.getElementById("eventModalTitle"),
  modalBody: document.getElementById("eventModalBody"),
  closeBtn: document.getElementById("eventCloseBtn"),
  editBtn: document.getElementById("eventEditBtn"),
  saveBtn: document.getElementById("eventSaveBtn"),
  completeBtn: document.getElementById("eventCompleteBtn"),
  deleteBtn: document.getElementById("eventDeleteBtn"),
};

// Todo UI elements
const todoUI = {
  tools: document.getElementById("adminTodoTools"),
  form: document.getElementById("todoForm"),
  title: document.getElementById("todoTitle"),
  desc: document.getElementById("todoDesc"),
  assignees: document.getElementById("todoAssignees"),
  createBtn: document.getElementById("createTodoBtn"),
  list: document.getElementById("todosList"),
};

// Menu buttons
const repMenuBtn = document.getElementById("repMenuBtn");
const repMenuDropdown = document.getElementById("repMenuDropdown");
const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");

// Initialize
async function init() {
  await waitForDomReady();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/index.html";
      } catch (err) {
        console.error("Logout error:", err);
        alert("Failed to sign out. Please try again.");
      }
    });
  }

  const { user } = await authStateReady();
  state.currentUser = user || auth.currentUser;
  console.log("[Page] Auth ready, userRole:", window.userRole);
  const routing = await handlePageRouting("shared");
  if (routing.redirected) return;

  if (!state.currentUser) {
    console.warn("[Rep] No authenticated user found after authStateReady");
    return;
  }

  console.log("[Rep] Auth OK");
  await delay(100);
  await initRepPage();
}

async function initRepPage() {
  console.log("[Rep] initRepPage started");
  try {
    displayCurrentDate();
    displayRandomQuote();
    loadPerformancePlaceholder();
    // Bind previous period navigation
    if (prevPeriodBtn){
      prevPeriodBtn.addEventListener('click', () => {
        state.payPeriodOffset -= 1;
        loadPerformanceStats();
      });
    }
    initCalendarControls();

    // Load identity first, then role-gated data to avoid permission errors
    await Promise.all([loadRepName(), checkRole()]);

    // Admin-only resources (user list and event/todo tools)
    if (state.isAdmin) {
      await loadReps().catch((e) => console.warn('[Rep] loadReps failed (admin-only)', e));
      bindEventForm();
      bindTodoForm();
      showAdminTools(true);
    } else {
      showAdminTools(false);
    }

    // Remaining widgets
    await Promise.all([
      loadPersonalTodos(),
      loadPerformanceStats(),
      loadAnnouncements(),
      loadCalendar(),
      loadAgendaForCurrentUser(),
    ]);
    console.log("[Rep] Dashboard initialised");
  } catch (error) {
    console.error("[Rep] Failed to initialise dashboard", error);
  }
}

// Load rep name from Firestore
async function loadRepName() {
  try {
    const userDoc = await getDoc(doc(db, "users", state.currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      state.repName = userData.name || "Rep";
    } else {
      // Fallback to email username
      state.repName = state.currentUser.email.split("@")[0];
    }
    repNameDisplay.textContent = state.repName;
  } catch (err) {
    console.error("Error loading rep name:", err);
    repNameDisplay.textContent = "Rep";
  }
}

// Check user role and show/hide menu items
async function checkRole() {
  try {
    const userDoc = await getDoc(doc(db, "users", state.currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      state.isAdmin = userData.role === "admin";

      // Show appropriate menu links
      const repHomeLink = document.getElementById("rep-home-link");
      const adminLink = document.getElementById("admin-dashboard-link");
      const scheduleLink = document.getElementById("schedule-link");
      const addCustomerLink = document.getElementById("add-customer-link");

      if (repHomeLink) repHomeLink.classList.remove("hidden");
      if (addCustomerLink) addCustomerLink.classList.remove("hidden");

      if (state.isAdmin) {
        if (adminLink) adminLink.classList.remove("hidden");
        if (scheduleLink) scheduleLink.classList.remove("hidden");
      }
    }
  } catch (err) {
    console.error("Error checking role:", err);
  }
}

async function loadReps(){
  // Only admins can list all reps per Firestore rules
  if (!state.isAdmin) return;
  try{
    const snap = await getDocs(query(collection(db,'users'), where('role','==','rep')));
    state.reps = snap.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
    // Populate multi-selects for events and todos
    if (eventUI.assignees){
      eventUI.assignees.innerHTML = state.reps
        .map(r=>`<option value="${r.id}">${escapeHtml(r.name||r.email||r.id)}</option>`) 
        .join('');
    }
    if (todoUI.assignees){
      todoUI.assignees.innerHTML = state.reps
        .map(r=>`<option value="${r.id}">${escapeHtml(r.name||r.email||r.id)}</option>`) 
        .join('');
    }
  }catch(err){ console.error('Failed to load reps', err); }
}

function showAdminTools(show){ 
  if (eventUI.tools) { if (show) eventUI.tools.hidden = false; else eventUI.tools.hidden = true; } 
  if (todoUI.tools) { if (show) todoUI.tools.hidden = false; else todoUI.tools.hidden = true; }
}

function bindEventForm(){
  if (!eventUI.form) return;
  eventUI.form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = eventUI.title.value.trim();
    const date = eventUI.date.value; // YYYY-MM-DD
    const time = eventUI.time.value || '';
    const desc = eventUI.desc.value.trim();
    const assignedRepIds = Array.from(eventUI.assignees.selectedOptions).map(o=>o.value);
    if (!title || !date){ alert('Please provide a title and date'); return; }
    try{
      const docRef = await addDoc(collection(db,'events'),{
        title, description: desc, dateISO: date, time, assignedRepIds,
        completed:false, deleted:false, createdAt: new Date().toISOString(), createdBy: state.currentUser.uid
      });
      // Clear form and reload month events
      eventUI.form.reset();
      await loadCalendar();
      alert('Event created');
    }catch(err){ console.error('Create event failed', err); alert('Failed to create event'); }
  });
}

function bindTodoForm(){
  if (!todoUI.form) return;
  todoUI.form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = todoUI.title.value.trim();
    const desc = todoUI.desc.value.trim();
    const assignedRepIds = Array.from(todoUI.assignees.selectedOptions).map(o=>o.value);
    if (!title){ alert('Please provide a task title'); return; }
    if (!assignedRepIds.length){ alert('Please select at least one rep'); return; }
    try{
      await addDoc(collection(db,'todos'),{
        title, description: desc, assignedRepIds, completed: false, deleted: false,
        createdAt: new Date().toISOString(), createdBy: state.currentUser.uid
      });
      todoUI.form.reset();
      alert('Task created for selected reps');
      // Reload todos if current user is also a rep (edge case: admin viewing their own rep todos)
      if (state.reps.some(r=>r.id===state.currentUser.uid)){
        await loadPersonalTodos();
      }
    }catch(err){ console.error('Create todo failed', err); alert('Failed to create task'); }
  });
}

// Display current date
function displayCurrentDate() {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const dateStr = new Date().toLocaleDateString("en-GB", options);
  currentDateEl.textContent = dateStr;
}

// Display random motivational quote
function displayRandomQuote() {
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  quoteTextEl.textContent = `"${randomQuote.text}"`;
  quoteAuthorEl.textContent = `— ${randomQuote.author}`;
}

// Load performance placeholder data (called during init, replaced by loadPerformanceStats)
function loadPerformancePlaceholder() {
  weeklySignupsEl.textContent = "--";
  weeklyTrendEl.textContent = "Loading...";
  weeklyTrendEl.className = "performance-card__trend performance-card__trend--neutral";
  monthlyMileageEl.textContent = "--";
  mileageTrendEl.textContent = "Loading...";
  mileageTrendEl.className = "performance-card__trend performance-card__trend--neutral";
  avgDailySignupsEl.textContent = "--";
  avgTrendEl.textContent = "Loading...";
  avgTrendEl.className = "performance-card__trend performance-card__trend--neutral";
}

// Calculate current pay period (20th to 20th)
function getCurrentPayPeriod(){
  const now = new Date();
  const day = now.getDate();
  let start, end;
  if (day >= 20){
    // Current period: 20th of this month to 20th of next month
    start = new Date(now.getFullYear(), now.getMonth(), 20, 0,0,0,0);
    end = new Date(now.getFullYear(), now.getMonth()+1, 20, 0,0,0,0);
  } else {
    // Current period: 20th of last month to 20th of this month
    start = new Date(now.getFullYear(), now.getMonth()-1, 20, 0,0,0,0);
    end = new Date(now.getFullYear(), now.getMonth(), 20, 0,0,0,0);
  }
  return { start, end, startISO: start.toISOString().slice(0,10), endISO: end.toISOString().slice(0,10) };
}

// Generic pay period with offset: 0 = current, -1 = previous, +1 = next
function getPayPeriod(offset = 0){
  let base = getCurrentPayPeriod();
  let { start, end } = base;
  if (offset !== 0){
    const steps = Math.abs(offset);
    for (let i=0;i<steps;i++){
      if (offset < 0){
        end = start; // move window backward
        start = new Date(start.getFullYear(), start.getMonth()-1, 20, 0,0,0,0);
      } else {
        start = end; // move window forward
        end = new Date(end.getFullYear(), end.getMonth()+1, 20, 0,0,0,0);
      }
    }
  }
  return { start, end, startISO: start.toISOString().slice(0,10), endISO: end.toISOString().slice(0,10) };
}

function formatPeriodBoundary(d){
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

function updatePeriodLabel(period){
  if (!periodLabelEl) return;
  periodLabelEl.textContent = `${formatPeriodBoundary(period.start)} – ${formatPeriodBoundary(period.end)}`;
}

// Load real performance stats for signed-in rep
async function loadPerformanceStats(){
  if (!state.currentUser){
    loadPerformancePlaceholder();
    return;
  }
  try {
  const period = getPayPeriod(state.payPeriodOffset || 0);
    const repUid = state.currentUser.uid;
    // Resolve rep display name once for quote matching
    let repNameForMatch = state.repName;
    if (!repNameForMatch) {
      try {
        const repDoc = await getDoc(doc(db,'users', repUid));
        repNameForMatch = repDoc.exists() ? (repDoc.data().name || repDoc.data().repName || '') : '';
      } catch(_) { repNameForMatch = ''; }
    }
    
    // Fetch all shifts for this rep in the pay period (doc-by-id per day to avoid composite index requirements)
    const shiftsMap = new Map();
    const cursor = new Date(period.start);
    const tasks = [];
    while (cursor < period.end){
      const iso = cursor.toISOString().slice(0,10);
      const shiftId = `${repUid}_${iso}`;
      tasks.push(getDoc(doc(db,'repShifts', shiftId)).then(snap=>{
        if (snap.exists()){
          shiftsMap.set(iso, snap.data());
        }
      }).catch(()=>{}));
      cursor.setDate(cursor.getDate()+1);
    }
    await Promise.all(tasks);
    
    // Calculate totals (miles and working days still from shifts)
    let totalSales = 0; // will be computed from quotes below
    let totalMiles = 0;
    let workingDays = 0;
    shiftsMap.forEach(shift=>{
      totalMiles += (shift.miles || 0);
      if ((shift.activeMinutes||0) > 0) workingDays++;
    });
    
    // Fetch this rep's signups from quotes in current pay period and compute verified subset
    // Total signups: quotes created in period with repCode == rep name
    // Verified: those with bookedDate within period
    let verifiedCount = 0;
    try {
      let total = 0;
      if (repNameForMatch) {
        const snap = await getDocs(query(collection(db,'quotes'), where('repCode','==', repNameForMatch)));
        snap.forEach(ds => {
          const q = ds.data() || {};
          if (q.deleted) return;
          // Determine creation time
          let created = null;
          if (q.createdAt?.toDate) { created = q.createdAt.toDate(); }
          else if (q.date) { try { created = new Date(q.date); } catch(_) {} }
          if (!created) return;
          if (created >= period.start && created < period.end) {
            total++;
            // Verified if bookedDate present and within period window
            if (q.bookedDate) {
              try {
                const bd = new Date(q.bookedDate);
                if (bd >= period.start && bd < period.end) {
                  verifiedCount++;
                }
              } catch(_) {}
            }
          }
        });
      }
      totalSales = total;
    } catch(err){ console.warn('Failed to count quotes for period', err); }
    
    // Update UI
    weeklySignupsEl.textContent = `${verifiedCount}/${totalSales}`;
    weeklyTrendEl.textContent = `${verifiedCount} verified`;
    weeklyTrendEl.className = verifiedCount >= totalSales*0.5 ? "performance-card__trend performance-card__trend--up" : "performance-card__trend performance-card__trend--neutral";
    
    monthlyMileageEl.textContent = totalMiles.toString();
    mileageTrendEl.textContent = `${workingDays} working days`;
    mileageTrendEl.className = "performance-card__trend performance-card__trend--neutral";
    
    const avgDaily = workingDays > 0 ? (verifiedCount / workingDays).toFixed(1) : '0.0';
    avgDailySignupsEl.textContent = avgDaily;
    const target = 4.0;
    const onTrack = parseFloat(avgDaily) >= target;
    avgTrendEl.textContent = onTrack ? 'On track' : `Target: ${target}/day`;
  avgTrendEl.className = onTrack ? "performance-card__trend performance-card__trend--up" : "performance-card__trend performance-card__trend--neutral";
  // Update label to reflect the currently viewed period
  updatePeriodLabel(period);
    
  } catch(err){
    console.error('Failed to load performance stats', err);
    loadPerformancePlaceholder();
  }
}

// Load announcements from Firestore
async function loadAnnouncements() {
  try {
    const announcementsQuery = query(
      collection(db, "announcements"),
      orderBy("date", "desc"),
      limit(5)
    );
    const snapshot = await getDocs(announcementsQuery);

    if (snapshot.empty) {
      announcementsListEl.innerHTML = `
        <div class="announcements-empty">
          <p>No announcements at this time. Check back soon!</p>
        </div>
      `;
      return;
    }

    const announcements = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    renderAnnouncements(announcements);
  } catch (err) {
    console.error("Error loading announcements:", err);
    // Show placeholder if collection doesn't exist yet
    announcementsListEl.innerHTML = `
      <div class="announcement-item">
        <div class="announcement-item__header">
          <h4 class="announcement-item__title">Welcome to the Rep Portal! 🎉</h4>
          <span class="announcement-item__date">3 Nov 2025</span>
        </div>
        <p class="announcement-item__message">
          Your new home for all rep resources, daily logging, team chat, and performance tracking. Explore the Quick Actions above to get started!
        </p>
      </div>
      <div class="announcement-item">
        <div class="announcement-item__header">
          <h4 class="announcement-item__title">New Rep Chat Feature</h4>
          <span class="announcement-item__date">1 Nov 2025</span>
        </div>
        <p class="announcement-item__message">
          Stay connected with your team! Use Rep Chat to share updates, ask questions, and collaborate in real-time.
        </p>
      </div>
      <div class="announcement-item">
        <div class="announcement-item__header">
          <h4 class="announcement-item__title">Daily Log Reminders</h4>
          <span class="announcement-item__date">28 Oct 2025</span>
        </div>
        <p class="announcement-item__message">
          Please remember to submit your daily mileage logs by 6 PM each day. This helps us process commission payments faster!
        </p>
      </div>
    `;
  }
}

// Render announcements
function renderAnnouncements(announcements) {
  announcementsListEl.innerHTML = announcements
    .map(
      (ann) => `
    <div class="announcement-item">
      <div class="announcement-item__header">
        <div>
          <h4 class="announcement-item__title">${escapeHtml(ann.title || "Announcement")}</h4>
          ${ann.isNew ? '<span class="announcement-item__badge announcement-item__badge--new">New</span>' : ""}
          ${ann.isUrgent ? '<span class="announcement-item__badge announcement-item__badge--urgent">Urgent</span>' : ""}
        </div>
        <span class="announcement-item__date">${formatDate(ann.date)}</span>
      </div>
      <p class="announcement-item__message">${escapeHtml(ann.message || "")}</p>
    </div>
  `
    )
    .join("");
}

// Format date helper
function formatDate(dateValue) {
  if (!dateValue) return "";
  let date;
  if (dateValue.toDate) {
    date = dateValue.toDate();
  } else if (typeof dateValue === "string") {
    date = new Date(dateValue);
  } else {
    date = dateValue;
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Escape HTML helper
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --------- Personal Todos ---------
async function loadPersonalTodos(){
  if (!state.currentUser) {
    console.warn('[Todos] No current user');
    return;
  }
  if (!todoUI.list) {
    console.warn('[Todos] todoUI.list element not found');
    return;
  }
  
  console.log('[Todos] Loading personal todos for:', state.currentUser.uid);
  const todos = [];
  
  // Get user's contract type from their user document
  let userContractType = 'freelance'; // default
  try {
    const userSnap = await getDoc(doc(db, 'users', state.currentUser.uid));
    if (userSnap.exists()) {
      const userData = userSnap.data();
      userContractType = userData.contractType || 'freelance';
      console.log('[Todos] User contract type:', userContractType, 'Raw data:', userData.contractType);
    } else {
      console.warn('[Todos] User document does not exist');
    }
  } catch(err) { 
    console.error('[Todos] Failed to load user contract type:', err); 
  }
  
  const contractTypeDisplay = userContractType === 'paye' ? 'PAYE' : 'Freelance';
  
  // Skip contract and policy todos for admins
  if (!state.isAdmin) {
    // 1. Check contract status (reps only)
    try{
      const contractSnap = await getDoc(doc(db,'contracts', state.currentUser.uid));
      const contract = contractSnap.exists() ? contractSnap.data() : null;
      const contractorSigned = !!(contract && contract.contractorSignedAt);
      const adminSigned = !!(contract && contract.adminSignedAt);
      
      console.log('[Todos] Contract status - exists:', contractSnap.exists(), 'contractorSigned:', contractorSigned, 'adminSigned:', adminSigned);
      
      // Auto contract status todos
      if (!contractorSigned){
      const todo = {
        id: 'contract-sign',
        title: `Complete ${contractTypeDisplay} contract`,
        description: 'Sign your employment contract to proceed.',
        completed: false,
        isSystem: true,
        action: '/rep/contract.html'
      };
      console.log('[Todos] Adding contract sign todo:', todo);
      todos.push(todo);
    } else if (!adminSigned){
      const todo = {
        id: 'contract-admin',
        title: `Awaiting admin signature for ${contractTypeDisplay} contract`,
        description: 'Your contract is pending admin approval.',
        completed: false,
        isSystem: true,
        action: null
      };
      console.log('[Todos] Adding admin signature wait todo:', todo);
      todos.push(todo);
    } else {
      // Both signed: show completed checkmark
      const todo = {
        id: 'contract-complete',
        title: `${contractTypeDisplay} contract fully signed`,
        description: 'Your contract is complete and countersigned.',
        completed: true,
        isSystem: true,
        action: null
      };
      console.log('[Todos] Adding completed contract todo:', todo);
      todos.push(todo);
    }
  }catch(err){ 
    console.error('[Todos] Failed to load contract status:', err); 
    // Fallback: treat as unsigned so rep still sees contract todo
    const fallbackTodo = {
      id: 'contract-sign',
      title: `Complete ${contractTypeDisplay} contract`,
      description: 'Sign your employment contract to proceed.',
      completed: false,
      isSystem: true,
      action: '/rep/contract.html'
    };
    todos.push(fallbackTodo);
    console.log('[Todos] Fallback added contract-sign todo due to error');
  }
  
  // 2. Check Policy Handbook acknowledgment (reps only)
  try {
    const userSnap = await getDoc(doc(db, 'users', state.currentUser.uid));
    if (userSnap.exists()) {
      const userData = userSnap.data();
      const policyAcknowledged = !!userData.policyAcknowledgedAt;
      
      if (!policyAcknowledged) {
        todos.push({
          id: 'policy-acknowledge',
          title: 'Acknowledge Policy Handbook',
          description: 'Read and acknowledge the company policy handbook.',
          completed: false,
          isSystem: true,
          action: '/rep/policy.html'
        });
      } else {
        // Show completed acknowledgment
        todos.push({
          id: 'policy-acknowledged',
          title: 'Policy Handbook acknowledged',
          description: `Acknowledged on ${new Date(userData.policyAcknowledgedAt).toLocaleDateString('en-GB')}`,
          completed: true,
          isSystem: true,
          action: null
        });
      }
    }
  } catch(err) {
    console.error('[Todos] Failed to check policy acknowledgment:', err);
  }
  } // End of !state.isAdmin block
  
  // 3. Fetch admin-created todos assigned to this rep (or all if admin)
  try{
    let snap;
    if (state.isAdmin) {
      // Admin sees ALL todos across all reps
      console.log('[Todos] Admin mode - fetching ALL todos');
      snap = await getDocs(query(collection(db,'todos')));
      console.log('[Todos] Found', snap.size, 'total todos in database');
    } else {
      // Reps see only their assigned todos
      snap = await getDocs(query(
        collection(db,'todos'),
        where('assignedRepIds','array-contains', state.currentUser.uid)
      ));
    }
    
    snap.forEach(ds=>{
      const t = ds.data();
      console.log('[Todos] Processing todo:', ds.id, t);
      if (t.deleted) {
        console.log('[Todos] Skipping deleted todo:', ds.id);
        return;
      }
      
      // For admin, show which reps are assigned
      let assignedInfo = '';
      if (state.isAdmin && t.assignedRepIds?.length) {
        const repNames = t.assignedRepIds.map(repId => {
          const rep = state.reps.find(r => r.id === repId);
          return rep?.name || repId;
        }).join(', ');
        assignedInfo = ` (${repNames})`;
      }
      
      todos.push({
        id: ds.id,
        title: (t.title || 'Task') + assignedInfo,
        description: t.description || '',
        completed: !!t.completed,
        isSystem: false,
        action: null
      });
    });
    console.log('[Todos] Loaded', snap.size, 'admin-created todos');
  }catch(err){ 
    console.error('[Todos] Failed to load admin todos:', err); 
  }
  
  console.log('[Todos] Total todos to render:', todos.length, todos);
  renderTodos(todos);
}

function renderTodos(todos){
  if (!todoUI.list) return;
  if (!todos.length){
    todoUI.list.innerHTML = '<div class="todos-empty">All done! ✓</div>';
    return;
  }
  todoUI.list.innerHTML = todos.map(t=>{
    const checkId = `todo-${t.id}`;
    const checked = t.completed ? 'checked' : '';
    const disabled = t.isSystem ? 'disabled' : ''; // System todos (contract) not manually toggleable by rep
    const linkHtml = t.action ? `<a href="${t.action}" class="todo-link">Complete →</a>` : '';
    return `
      <div class="todo-item ${t.completed?'todo-item--completed':''}">
        <label class="todo-checkbox">
          <input type="checkbox" id="${checkId}" data-todo-id="${t.id}" data-is-system="${t.isSystem}" ${checked} ${disabled} onchange="window.toggleTodo('${t.id}', this.checked, ${t.isSystem})" />
          <span class="todo-title">${escapeHtml(t.title)}</span>
        </label>
        ${t.description?`<div class="todo-desc">${escapeHtml(t.description)}</div>`:''}
        ${linkHtml}
      </div>
    `;
  }).join('');
}

// Toggle todo completion (only for admin-created, not system/contract todos)
window.toggleTodo = async function(todoId, completed, isSystem){
  if (isSystem) return; // No manual toggle for contract status
  if (!state.currentUser) return;
  try{
    await updateDoc(doc(db,'todos', todoId), { completed, updatedAt: new Date().toISOString(), updatedBy: state.currentUser.uid });
    // Reload to reflect change
    await loadPersonalTodos();
  }catch(err){
    console.error('Failed to update todo', err);
    alert('Failed to update task');
    await loadPersonalTodos(); // Revert UI
  }
};

// Start the app
init();

// -------------------------
// Rep Logs Calendar (read-only on Home)
// -------------------------

let currentMonthOffset = 0;
let currentLogId = null;

function startOfMonth(d){ const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d){ const x=new Date(d); x.setMonth(x.getMonth()+1); x.setDate(0); x.setHours(23,59,59,999); return x; }

function initCalendarControls() {
  // Simple prev/next month arrows
  calEls.prevBtn?.addEventListener('click', async () => {
    currentMonthOffset -= 1;
    await loadCalendar();
  });
  calEls.nextBtn?.addEventListener('click', async () => {
    currentMonthOffset += 1;
    await loadCalendar();
  });

  // Modal close
  calEls.closeLogModalBtn?.addEventListener('click', () => calEls.logModal?.setAttribute('hidden',''));
  // Show delete if admin
  if (!state.isAdmin && calEls.deleteLogBtn) {
    calEls.deleteLogBtn.classList.add('hidden');
    calEls.deleteLogBtn.disabled = true;
  }
}

async function loadCalendar() {
  if (!calEls.calendar) return;
  const today = new Date();
  today.setMonth(today.getMonth() + currentMonthOffset);
  // Update month label above the grid
  if (calEls.calendarMonth) {
    calEls.calendarMonth.textContent = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const startISO = start.toISOString().slice(0,10);
  const endISO = end.toISOString().slice(0,10);

  // Fetch shift summaries for the current user only (doc-by-id to avoid query rule/index issues)
  let shiftsByDate = new Map();
  if (state.currentUser) {
    try {
      const tasks = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const iso = cursor.toISOString().slice(0,10);
        const id = `${state.currentUser.uid}_${iso}`;
        tasks.push(getDoc(doc(db, 'repShifts', id)).then(snap => {
          if (snap.exists()) {
            const data = snap.data();
            shiftsByDate.set(iso, { id: snap.id, ...data });
          }
        }).catch(() => {}));
        cursor.setDate(cursor.getDate() + 1);
      }
      await Promise.all(tasks);
    } catch (err) {
      console.warn('Shift summaries not available', err?.message || err);
    }
  }

  // For now, skip querying individual door logs on Rep Home to reduce load and avoid rules/index issues.
  // We already show per-day shift summaries for the current user.
  let byDate = new Map();

  // Fetch events for the month range (avoid composite indexes by filtering client-side)
  state.monthEvents = new Map();
  try{
    const evSnap = await getDocs(query(
      collection(db,'events'),
      where('dateISO','>=',startISO),
      where('dateISO','<=',endISO)
    ));
    evSnap.forEach(ds=>{
      const ev = { id: ds.id, ...(ds.data()||{}) };
      if (ev.deleted) return; // client-side filter to avoid composite index
      
      // Admin sees ALL events; reps see only events assigned to them
      if (state.isAdmin) {
        // Show all events for admin
        if (!state.monthEvents.has(ev.dateISO)) state.monthEvents.set(ev.dateISO, []);
        state.monthEvents.get(ev.dateISO).push(ev);
      } else {
        // Only include events assigned to this rep (private to them)
        const assigned = Array.isArray(ev.assignedRepIds) ? ev.assignedRepIds.includes(state.currentUser.uid) : false;
        if (!assigned) return;
        if (!state.monthEvents.has(ev.dateISO)) state.monthEvents.set(ev.dateISO, []);
        state.monthEvents.get(ev.dateISO).push(ev);
      }
    });
  }catch(err){ console.error('Failed to load events', err); }

  // Render grid with day boxes + shift summaries for current user
  calEls.calendar.innerHTML = '';
  const pad = (start.getDay() + 6) % 7; // Monday-first
  for (let i=0;i<pad;i++){ const d=document.createElement('div'); d.className='rep-day empty'; calEls.calendar.appendChild(d); }
  const daysInMonth = end.getDate();
  for (let day=1; day<=daysInMonth; day++){
    const d = new Date(start); d.setDate(day);
    const iso = d.toISOString().slice(0,10);
    const cell = document.createElement('div');
    cell.className = 'rep-day';
    cell.dataset.date = iso;
    const logs = byDate.get(iso) || [];
    const events = state.monthEvents.get(iso) || [];
    const shift = shiftsByDate.get(iso);
    
    let badgesHtml = '';
    
    // Show shift summary for current user if exists
    if (shift && shift.repId === state.currentUser.uid) {
      const totals = shift.totals || {};
      const sales = totals.sales || 0;
      const doors = totals.doors || 0;
      const hours = shift.activeMinutes ? (shift.activeMinutes / 60).toFixed(1) : '0';
      const miles = shift.miles || 0;
      
      badgesHtml += `<div class="shift-summary" title="Your shift on ${iso}">
        📊 ${sales} sales • ${doors} doors<br/>
        ⏱️ ${hours}h • 🚗 ${miles}mi
      </div>`;
    }
    
    // Door log badges omitted on Home to reduce noise and queries
    
    const eventBadges = events.map(e=> {
      const isContract = (e.title||'').toLowerCase().includes('contract');
      const icon = isContract ? '📄 ' : '';
      
      // For admin, show which reps are assigned to this event
      let repInfo = '';
      if (state.isAdmin && e.assignedRepIds?.length) {
        const repNames = e.assignedRepIds.map(repId => {
          const rep = state.reps.find(r => r.id === repId);
          return rep?.name || repId.substring(0, 8);
        }).join(', ');
        repInfo = ` [${repNames}]`;
      }
      
      const displayText = (e.time ? e.time + ' ' : '') + (e.title || 'Event') + repInfo;
      return `<button class=\"event-badge ${e.completed?'event-badge--completed':''} ${isContract?'event-badge--contract':''}\" data-event-id=\"${e.id}\" title=\"${escapeHtml(e.title||'Event')}\">${icon}${escapeHtml(displayText)}</button>`;
    }).join('');
    cell.innerHTML = `<div class=\"rep-day__date\">${day}</div><div class=\"rep-day__badges\">${badgesHtml}${eventBadges}</div>`;

    // Click on a rep badge opens that rep's log for the day (first if multiple)
    // No rep-badge handlers (omitted)
    calEls.calendar.appendChild(cell);
    // Wire event click handlers
    cell.querySelectorAll('.event-badge').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = btn.getAttribute('data-event-id');
        const ev = (state.monthEvents.get(iso)||[]).find(x=>x.id===id);
        if (ev) openEventModal(ev);
      });
    });
  }
}

function openLogModal(log){
  if (!calEls.logModal) return;
  const repName = log.rep || 'Unknown';
  calEls.logModalTitle.textContent = `Log - ${repName}`;
  calEls.logModalContent.textContent = log.logText || '(No log content)';
  currentLogId = log.id || null;
  if (calEls.deleteLogBtn){
    if (state.isAdmin && currentLogId) {
      calEls.deleteLogBtn.classList.remove('hidden');
      calEls.deleteLogBtn.disabled = false;
    } else {
      calEls.deleteLogBtn.classList.add('hidden');
      calEls.deleteLogBtn.disabled = true;
    }
  }
  calEls.logModal.removeAttribute('hidden');
}

// --------- Event modal ---------
function openEventModal(ev){
  state.currentEvent = ev;
  if (!eventUI.modal) return;
  eventUI.modalTitle.textContent = ev.title || 'Event';
  eventUI.modalBody.innerHTML = `
    <div><strong>Date:</strong> ${escapeHtml(ev.dateISO||'')}</div>
    ${ev.time?`<div><strong>Time:</strong> ${escapeHtml(ev.time)}</div>`:''}
    ${ev.description?`<div><strong>Details:</strong> ${escapeHtml(ev.description)}</div>`:''}
    <div><strong>Assigned:</strong> ${formatAssignees(ev.assignedRepIds||[])}</div>
    ${ev.completed?`<div class="status success" style="margin-top:8px">Completed</div>`:''}
  `;
  // Admin controls
  const isAdmin = state.isAdmin;
  eventUI.editBtn.hidden = !isAdmin;
  eventUI.completeBtn.hidden = !isAdmin || !!ev.completed;
  eventUI.deleteBtn.hidden = !isAdmin;
  eventUI.saveBtn.hidden = true;

  eventUI.modal.removeAttribute('hidden');
}

function closeEventModal(){ eventUI.modal?.setAttribute('hidden',''); }

function formatAssignees(ids){
  if (!ids?.length) return '—';
  const names = ids.map(id=>{
    const r = state.reps.find(x=>x.id===id);
    return r?.name || r?.email || id;
  });
  return names.map(n=>escapeHtml(n)).join(', ');
}

// Event modal button bindings
eventUI?.closeBtn?.addEventListener('click', closeEventModal);
eventUI?.deleteBtn?.addEventListener('click', async ()=>{
  if (!state.currentEvent) return; if (!confirm('Delete this event?')) return;
  try{ await updateDoc(doc(db,'events', state.currentEvent.id), { deleted:true, updatedAt: new Date().toISOString() }); closeEventModal(); await loadCalendar(); }catch(err){ console.error('Delete failed', err); alert('Delete failed'); }
});
eventUI?.completeBtn?.addEventListener('click', async ()=>{
  if (!state.currentEvent) return;
  try{ await updateDoc(doc(db,'events', state.currentEvent.id), { completed:true, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); closeEventModal(); await loadCalendar(); }catch(err){ console.error('Complete failed', err); alert('Update failed'); }
});
eventUI?.editBtn?.addEventListener('click', ()=>{
  if (!state.currentEvent) return;
  // Render inline edit form in modal
  const ev = state.currentEvent;
  eventUI.modalBody.innerHTML = `
    <label class="event-field"><span>Title</span><input id="editEventTitle" type="text" value="${escapeHtml(ev.title||'')}"/></label>
    <div class="event-row">
      <label class="event-field"><span>Date</span><input id="editEventDate" type="date" value="${escapeHtml(ev.dateISO||'')}"/></label>
      <label class="event-field"><span>Time</span><input id="editEventTime" type="time" value="${escapeHtml(ev.time||'')}"/></label>
    </div>
    <label class="event-field"><span>Description</span><textarea id="editEventDesc" rows="3">${escapeHtml(ev.description||'')}</textarea></label>
    <label class="event-field"><span>Assign reps</span><select id="editEventAssignees" multiple size="5">${state.reps.map(r=>`<option value="${r.id}" ${ev.assignedRepIds?.includes(r.id)?'selected':''}>${escapeHtml(r.name||r.email||r.id)}</option>`).join('')}</select></label>
  `;
  eventUI.saveBtn.hidden = false; eventUI.editBtn.hidden = true; eventUI.completeBtn.hidden = !!ev.completed; eventUI.deleteBtn.hidden = false;
});
eventUI?.saveBtn?.addEventListener('click', async ()=>{
  if (!state.currentEvent) return;
  const title = (document.getElementById('editEventTitle')?.value||'').trim();
  const dateISO = document.getElementById('editEventDate')?.value||'';
  const time = document.getElementById('editEventTime')?.value||'';
  const description = (document.getElementById('editEventDesc')?.value||'').trim();
  const assignedRepIds = Array.from(document.getElementById('editEventAssignees')?.selectedOptions||[]).map(o=>o.value);
  if (!title || !dateISO){ alert('Please provide a title and date'); return; }
  try{
    await updateDoc(doc(db,'events', state.currentEvent.id), { title, dateISO, time, description, assignedRepIds, updatedAt: new Date().toISOString() });
    closeEventModal(); await loadCalendar();
  }catch(err){ console.error('Save failed', err); alert('Save failed'); }
});

// --------- Agenda in announcements ---------
async function loadAgendaForCurrentUser(){
  if (!state.currentUser) return;
  const todayISO = new Date().toISOString().slice(0,10);
  try{
    let snap;
    if (state.isAdmin) {
      // Admin sees ALL upcoming events across all reps
      snap = await getDocs(query(collection(db,'events')));
    } else {
      // Use a single array-contains filter and apply date/deleted filters client-side to avoid composite index
      snap = await getDocs(query(
        collection(db,'events'),
        where('assignedRepIds','array-contains', state.currentUser.uid)
      ));
    }
    
    const items = snap.docs
      .map(d=>({ id:d.id, ...(d.data()||{}) }))
      .filter(ev => !ev.deleted && String(ev.dateISO||'') >= todayISO)
      .sort((a,b)=> String(a.dateISO||'').localeCompare(String(b.dateISO||'')));
    renderAgenda(items);
  }catch(err){ console.error('Failed to load agenda', err); }
}

function renderAgenda(items){
  if (!announcementsListEl) return;
  if (!items?.length) return; // no-op
  
  const title = state.isAdmin ? 'All Upcoming Events' : 'Your Upcoming Events';
  
  const html = `
    <div class="announcement-item">
      <div class="announcement-item__header">
        <h4 class="announcement-item__title">${title}</h4>
        <span class="announcement-item__date">${new Date().toLocaleDateString('en-GB')}</span>
      </div>
      <ul class="modal__list">
        ${items.map(ev=>{
          const isContract = (ev.title||'').toLowerCase().includes('contract');
          const icon = isContract ? '📄 ' : '';
          
          // For admin, show which reps are assigned
          let repInfo = '';
          if (state.isAdmin && ev.assignedRepIds?.length) {
            const repNames = ev.assignedRepIds.map(repId => {
              const rep = state.reps.find(r => r.id === repId);
              return rep?.name || repId.substring(0, 8);
            }).join(', ');
            repInfo = ` <span style="color: #64748b;">[${repNames}]</span>`;
          }
          
          return `<li><strong>${icon}${escapeHtml(ev.dateISO)}${ev.time?(' '+escapeHtml(ev.time)) : ''} — ${escapeHtml(ev.title||'Event')}${repInfo}</strong>${ev.description?`<div>${escapeHtml(ev.description)}</div>`:''}</li>`;
        }).join('')}
      </ul>
    </div>`;
  announcementsListEl.insertAdjacentHTML('afterbegin', html);
}

