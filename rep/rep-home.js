import { auth, db } from '../firebase-init.js';
import { authStateReady } from '../auth-check.js';
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

  await authStateReady();
  console.log("[Page] Auth ready, userRole:", window.userRole);
  if (window.userRole !== "rep") {
    console.warn("[Rep] Non-rep user detected on rep page. Redirecting to login.");
    window.location.replace("/index-login.html");
    return;
  }

  await delay(100);
  initRepPage();
}

function initRepPage() {
  console.log("[Rep] initRepPage started");
  startRepApp?.();
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
  try{
    const snap = await getDocs(query(collection(db,'users'), where('role','==','rep')));
    state.reps = snap.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
    // Populate multi-select
    if (eventUI.assignees){
      eventUI.assignees.innerHTML = state.reps
        .map(r=>`<option value="${r.id}">${escapeHtml(r.name||r.email||r.id)}</option>`) 
        .join('');
    }
  }catch(err){ console.error('Failed to load reps', err); }
}

function showAdminTools(show){ if (eventUI.tools) { if (show) eventUI.tools.hidden = false; else eventUI.tools.hidden = true; } }

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

// Load performance placeholder data
function loadPerformancePlaceholder() {
  // Placeholder values - will be replaced with real data later
  weeklySignupsEl.textContent = "12";
  weeklyTrendEl.textContent = "↑ +3 from last week";
  weeklyTrendEl.className = "performance-card__trend performance-card__trend--up";

  monthlyMileageEl.textContent = "487";
  mileageTrendEl.textContent = "↑ +52 miles";
  mileageTrendEl.className = "performance-card__trend performance-card__trend--up";

  avgDailySignupsEl.textContent = "2.4";
  avgTrendEl.textContent = "On track";
  avgTrendEl.className = "performance-card__trend performance-card__trend--neutral";
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

  // Fetch all reps' logs for the month range
  let byDate = new Map();
  try {
    const constraints = [where('dateISO','>=',startISO), where('dateISO','<=',endISO), orderBy('dateISO')];
    const snap = await getDocs(query(collection(db,'repLogs'), ...constraints));
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!byDate.has(data.dateISO)) byDate.set(data.dateISO, []);
      byDate.get(data.dateISO).push({ id: docSnap.id, ...data });
    });
  } catch (err) {
    console.error('Failed to load rep logs', err);
  }

  // Fetch events for the month range
  state.monthEvents = new Map();
  try{
    const evSnap = await getDocs(query(
      collection(db,'events'),
      where('dateISO','>=',startISO),
      where('dateISO','<=',endISO),
      where('deleted','==', false)
    ));
    evSnap.forEach(ds=>{
      const ev = { id: ds.id, ...(ds.data()||{}) };
      if (!state.monthEvents.has(ev.dateISO)) state.monthEvents.set(ev.dateISO, []);
      state.monthEvents.get(ev.dateISO).push(ev);
    });
  }catch(err){ console.error('Failed to load events', err); }

  // Render grid with day boxes + rep badges (clickable)
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
    let badgesHtml = '';
    if (logs.length){
      const repGroups = new Map();
      logs.forEach(l=>{ const name = l.rep || 'Unknown'; if(!repGroups.has(name)) repGroups.set(name,[]); repGroups.get(name).push(l); });
      badgesHtml = Array.from(repGroups.entries()).map(([name, arr]) => {
        const count = arr.length > 1 ? ` (${arr.length})` : '';
        return `<div class=\"rep-badge\" data-date=\"${iso}\" data-rep=\"${name}\">${name}${count}</div>`;
      }).join('');
    }
    const eventBadges = events.map(e=>
      `<button class=\"event-badge ${e.completed?'event-badge--completed':''}\" data-event-id=\"${e.id}\" title=\"${escapeHtml(e.title||'Event')}\">${escapeHtml((e.time?e.time+' ':'') + (e.title||'Event'))}</button>`
    ).join('');
    cell.innerHTML = `<div class=\"rep-day__date\">${day}</div><div class=\"rep-day__badges\">${badgesHtml}${eventBadges}</div>`;

    // Click on a rep badge opens that rep's log for the day (first if multiple)
    cell.querySelectorAll('.rep-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const repName = badge.dataset.rep;
        const repLogs = logs.filter(l => (l.rep || 'Unknown') === repName);
        if (repLogs.length) openLogModal(repLogs[0]);
      });
    });
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
    const snap = await getDocs(query(
      collection(db,'events'),
      where('assignedRepIds','array-contains', state.currentUser.uid),
      where('dateISO','>=', todayISO),
      where('deleted','==', false)
    ));
    const items = snap.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
    renderAgenda(items.sort((a,b)=>a.dateISO.localeCompare(b.dateISO)));
  }catch(err){ console.error('Failed to load agenda', err); }
}

function renderAgenda(items){
  if (!announcementsListEl) return;
  if (!items?.length) return; // no-op
  const html = `
    <div class="announcement-item">
      <div class="announcement-item__header">
        <h4 class="announcement-item__title">Your Upcoming Events</h4>
        <span class="announcement-item__date">${new Date().toLocaleDateString('en-GB')}</span>
      </div>
      <ul class="modal__list">
        ${items.map(ev=>`<li><strong>${escapeHtml(ev.dateISO)}${ev.time?(' '+escapeHtml(ev.time)) : ''} — ${escapeHtml(ev.title||'Event')}</strong>${ev.description?`<div>${escapeHtml(ev.description)}</div>`:''}</li>`).join('')}
      </ul>
    </div>`;
  announcementsListEl.insertAdjacentHTML('afterbegin', html);
}

