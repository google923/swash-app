// subscriber-scheduler.js - Modified scheduler for subscribers using their own data
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  setDoc,
  arrayUnion,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const db = getFirestore();
const auth = getAuth();

let subscriberId = null;
let schedulerInitialised = false;

const INITIAL_WEEKS = 4;

const state = {
  quotes: [],
  startDate: null,
  searchTerm: "",
  draggingIds: [],
  dragOriginDate: null,
  dragTargetJobId: null,
  weeksVisible: INITIAL_WEEKS,
  selectedJobIds: new Set(),
  cleanerFilter: "",
  showSaturday: false,
  cleaners: [],
};

const elements = {
  startWeek: document.getElementById("startWeek"),
  generate: document.getElementById("generate"),
  viewToday: document.getElementById("viewToday"),
  toggleSaturday: document.getElementById("toggleSaturday"),
  search: document.getElementById("scheduleSearch"),
  schedule: document.getElementById("schedule"),
  showPreviousWeek: document.getElementById("showPreviousWeek"),
  showNextWeek: document.getElementById("showNextWeek"),
  selectionInfo: document.getElementById("selectionInfo"),
  selectionCount: document.getElementById("selectionCount"),
  selectionTotal: document.getElementById("selectionTotal"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  cleanerFilter: document.getElementById("cleanerFilter"),
  refresh: document.getElementById("refresh"),
};

// Initialize on auth
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = './subscriber-login.html';
    return;
  }

  try {
    const userDoc = await getDocs(query(collection(db, 'users'), where('__name__', '==', user.uid)));
    if (userDoc.empty) throw new Error('User not found');

    const userData = userDoc.docs[0].data();
    
    if (userData.role !== 'subscriber') {
      throw new Error('Access denied');
    }

    if (!userData.billingCompleted) {
      window.location.href = './subscriber-billing.html';
      return;
    }

    subscriberId = user.uid;
    await initScheduler();

  } catch (error) {
    console.error('Auth error:', error);
    alert(error.message);
    await signOut(auth);
    window.location.href = './subscriber-login.html';
  }
});

async function initScheduler() {
  if (schedulerInitialised) return;
  schedulerInitialised = true;

  await loadCleaners();
  await fetchBookedQuotes();
  populateCleanerFilter();
  
  const today = new Date();
  const monday = normalizeStartDate(today);
  elements.startWeek.valueAsDate = monday;
  state.startDate = monday;
  
  attachEventListeners();
  generateSchedule();
}

async function loadCleaners() {
  try {
    const cleanersRef = collection(db, `subscribers/${subscriberId}/cleaners`);
    const snapshot = await getDocs(cleanersRef);
    state.cleaners = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(c => c.status === 'active');
  } catch (error) {
    console.error('Error loading cleaners:', error);
    state.cleaners = [];
  }
}

async function fetchBookedQuotes() {
  try {
    const customersRef = collection(db, `subscribers/${subscriberId}/customers`);
    const bookedQuery = query(customersRef, where('status', '==', 'booked'));
    const snapshot = await getDocs(bookedQuery);
    
    state.quotes = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        customerName: data.name,
        address: data.address,
        mobile: data.mobile,
        email: data.email,
        tier: data.tier,
        price: data.price,
        pricePerClean: data.pricePerClean,
        bookedDate: data.bookedDate,
        nextCleanDates: data.nextCleanDates || [],
        assignedCleaner: data.assignedCleaner,
        status: data.status,
        routeOrder: data.routeOrder || {},
      };
    });
  } catch (error) {
    console.error('Error loading customers:', error);
    state.quotes = [];
  }
}

function populateCleanerFilter() {
  elements.cleanerFilter.innerHTML = '<option value="">All Cleaners</option>';
  elements.cleanerFilter.innerHTML += '<option value="UNASSIGNED">Unassigned</option>';
  
  state.cleaners.forEach(cleaner => {
    const option = document.createElement('option');
    option.value = cleaner.id;
    option.textContent = cleaner.name;
    elements.cleanerFilter.appendChild(option);
  });
}

function normalizeStartDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function formatDate(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatScheduleDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getOccurrences(bookedDate, nextCleanDates, startDate, endDate) {
  const occurrences = [];
  const start = startDate.getTime();
  const end = endDate.getTime();

  if (bookedDate) {
    const firstClean = new Date(bookedDate);
    if (firstClean.getTime() >= start && firstClean.getTime() <= end) {
      occurrences.push(firstClean);
    }
  }

  if (nextCleanDates && nextCleanDates.length > 0) {
    nextCleanDates.forEach(dateStr => {
      const cleanDate = new Date(dateStr);
      if (cleanDate.getTime() >= start && cleanDate.getTime() <= end) {
        occurrences.push(cleanDate);
      }
    });
  }

  // Generate recurring 28-day intervals
  if (bookedDate) {
    let currentDate = new Date(bookedDate);
    while (currentDate.getTime() <= end) {
      if (currentDate.getTime() >= start) {
        if (!occurrences.some(d => d.toDateString() === currentDate.toDateString())) {
          occurrences.push(new Date(currentDate));
        }
      }
      currentDate.setDate(currentDate.getDate() + 28);
    }
  }

  return occurrences.sort((a, b) => a - b);
}

function generateSchedule() {
  if (!state.startDate) return;

  const startDate = normalizeStartDate(state.startDate);
  const daysPerWeek = state.showSaturday ? 6 : 5;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (state.weeksVisible * 7) - 1);

  // Filter quotes
  let filtered = state.quotes;
  
  if (state.searchTerm) {
    const term = state.searchTerm.toLowerCase();
    filtered = filtered.filter(q =>
      (q.customerName || '').toLowerCase().includes(term) ||
      (q.address || '').toLowerCase().includes(term)
    );
  }

  if (state.cleanerFilter) {
    if (state.cleanerFilter === 'UNASSIGNED') {
      filtered = filtered.filter(q => !q.assignedCleaner);
    } else {
      filtered = filtered.filter(q => q.assignedCleaner === state.cleanerFilter);
    }
  }

  // Build schedule grid
  const grid = document.createElement('div');
  grid.className = 'schedule-grid';
  grid.style.gridTemplateColumns = `120px repeat(${daysPerWeek}, 1fr)`;

  // Headers
  grid.innerHTML = '<div class="week-label">Week</div>';
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (let i = 0; i < daysPerWeek; i++) {
    const header = document.createElement('div');
    header.className = 'day-header';
    header.textContent = dayNames[i];
    grid.appendChild(header);
  }

  // Build week by week
  for (let week = 0; week < state.weeksVisible; week++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + (week * 7));

    // Week label
    const weekLabel = document.createElement('div');
    weekLabel.className = 'week-label';
    weekLabel.textContent = `Week ${week + 1}`;
    grid.appendChild(weekLabel);

    // Days of week
    for (let day = 0; day < daysPerWeek; day++) {
      const currentDate = new Date(weekStart);
      currentDate.setDate(currentDate.getDate() + day);

      const dayCell = document.createElement('div');
      dayCell.className = 'day-cell';
      dayCell.dataset.date = currentDate.toISOString().split('T')[0];

      const dateLabel = document.createElement('div');
      dateLabel.className = 'day-date';
      dateLabel.textContent = formatDate(currentDate);
      dayCell.appendChild(dateLabel);

      // Find jobs for this day
      const jobsThisDay = [];
      filtered.forEach(quote => {
        const occurrences = getOccurrences(
          quote.bookedDate,
          quote.nextCleanDates,
          currentDate,
          currentDate
        );
        if (occurrences.length > 0) {
          jobsThisDay.push(quote);
        }
      });

      // Sort by route order if exists
      const dateKey = currentDate.toISOString().split('T')[0];
      jobsThisDay.sort((a, b) => {
        const orderA = a.routeOrder?.[dateKey] ?? 999;
        const orderB = b.routeOrder?.[dateKey] ?? 999;
        return orderA - orderB;
      });

      // Render jobs
      let totalPrice = 0;
      jobsThisDay.forEach((quote, index) => {
        const jobDiv = document.createElement('div');
        jobDiv.className = 'schedule-job';
        jobDiv.dataset.quoteId = quote.id;
        jobDiv.dataset.date = dateKey;
        jobDiv.draggable = true;
        
        if (state.selectedJobIds.has(quote.id)) {
          jobDiv.classList.add('selected');
        }

        const jobName = document.createElement('div');
        jobName.className = 'job-name';
        jobName.textContent = `${index + 1}. ${quote.customerName || 'Unknown'}`;
        jobDiv.appendChild(jobName);

        const jobMeta = document.createElement('div');
        jobMeta.className = 'job-meta';
        jobMeta.textContent = `£${quote.pricePerClean || quote.price || 0}`;
        jobDiv.appendChild(jobMeta);

        if (quote.assignedCleaner) {
          const cleanerName = state.cleaners.find(c => c.id === quote.assignedCleaner)?.name || 'Unknown';
          const badge = document.createElement('div');
          badge.className = 'cleaner-badge';
          badge.textContent = cleanerName;
          jobDiv.appendChild(badge);
        }

        // Click handler
        jobDiv.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) {
            toggleJobSelection(quote.id);
            generateSchedule();
          }
        });

        // Drag handlers
        jobDiv.addEventListener('dragstart', handleDragStart);
        jobDiv.addEventListener('dragend', handleDragEnd);

        dayCell.appendChild(jobDiv);
        totalPrice += parseFloat(quote.pricePerClean || quote.price || 0);
      });

      // Drag over handlers
      dayCell.addEventListener('dragover', handleDragOver);
      dayCell.addEventListener('drop', handleDrop);

      // Day total
      if (jobsThisDay.length > 0) {
        const totalDiv = document.createElement('div');
        totalDiv.className = 'day-total';
        totalDiv.textContent = `${jobsThisDay.length} jobs • £${totalPrice.toFixed(2)}`;
        dayCell.appendChild(totalDiv);
      }

      grid.appendChild(dayCell);
    }
  }

  elements.schedule.innerHTML = '';
  elements.schedule.appendChild(grid);
  
  updateSelectionInfo();
}

function toggleJobSelection(jobId) {
  if (state.selectedJobIds.has(jobId)) {
    state.selectedJobIds.delete(jobId);
  } else {
    state.selectedJobIds.add(jobId);
  }
}

function updateSelectionInfo() {
  if (state.selectedJobIds.size === 0) {
    elements.selectionInfo.hidden = true;
    return;
  }

  elements.selectionInfo.hidden = false;
  elements.selectionCount.textContent = `${state.selectedJobIds.size} selected`;
  
  const total = Array.from(state.selectedJobIds).reduce((sum, id) => {
    const quote = state.quotes.find(q => q.id === id);
    return sum + (parseFloat(quote?.pricePerClean || quote?.price || 0));
  }, 0);
  
  elements.selectionTotal.textContent = `£${total.toFixed(2)}`;
}

function handleDragStart(e) {
  const jobId = e.target.dataset.quoteId;
  const date = e.target.dataset.date;
  
  if (state.selectedJobIds.has(jobId)) {
    state.draggingIds = Array.from(state.selectedJobIds);
  } else {
    state.draggingIds = [jobId];
  }
  
  state.dragOriginDate = date;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', jobId);
  e.target.style.opacity = '0.4';
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  state.draggingIds = [];
  state.dragOriginDate = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e) {
  e.preventDefault();
  
  const targetDate = e.currentTarget.dataset.date;
  if (!targetDate || state.draggingIds.length === 0) return;
  
  if (targetDate === state.dragOriginDate) return;
  
  try {
    for (const jobId of state.draggingIds) {
      const quote = state.quotes.find(q => q.id === jobId);
      if (!quote) continue;
      
      // Update bookedDate to new date
      const newDate = new Date(targetDate);
      const customerRef = doc(db, `subscribers/${subscriberId}/customers`, jobId);
      
      // Recalculate nextCleanDates
      const secondClean = new Date(newDate);
      secondClean.setDate(secondClean.getDate() + 28);
      const thirdClean = new Date(newDate);
      thirdClean.setDate(thirdClean.getDate() + 56);
      
      await updateDoc(customerRef, {
        bookedDate: newDate.toISOString(),
        nextCleanDates: [secondClean.toISOString(), thirdClean.toISOString()]
      });
    }
    
    await fetchBookedQuotes();
    generateSchedule();
    
  } catch (error) {
    console.error('Error moving jobs:', error);
    alert('Failed to move jobs: ' + error.message);
  }
}

function attachEventListeners() {
  elements.generate.addEventListener('click', () => {
    state.startDate = elements.startWeek.valueAsDate;
    generateSchedule();
  });

  elements.viewToday.addEventListener('click', () => {
    const today = new Date();
    const monday = normalizeStartDate(today);
    elements.startWeek.valueAsDate = monday;
    state.startDate = monday;
    generateSchedule();
  });

  elements.toggleSaturday.addEventListener('click', () => {
    state.showSaturday = !state.showSaturday;
    elements.toggleSaturday.textContent = state.showSaturday ? '📆 Hide Saturday' : '📆 Show Saturday';
    generateSchedule();
  });

  elements.cleanerFilter.addEventListener('change', (e) => {
    state.cleanerFilter = e.target.value;
    generateSchedule();
  });

  elements.search.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    generateSchedule();
  });

  elements.showPreviousWeek.addEventListener('click', () => {
    const newStart = new Date(state.startDate);
    newStart.setDate(newStart.getDate() - 7);
    state.startDate = newStart;
    elements.startWeek.valueAsDate = newStart;
    generateSchedule();
  });

  elements.showNextWeek.addEventListener('click', () => {
    const newStart = new Date(state.startDate);
    newStart.setDate(newStart.getDate() + 7);
    state.startDate = newStart;
    elements.startWeek.valueAsDate = newStart;
    generateSchedule();
  });

  elements.clearSelectionBtn?.addEventListener('click', () => {
    state.selectedJobIds.clear();
    generateSchedule();
  });

  elements.refresh?.addEventListener('click', async () => {
    await fetchBookedQuotes();
    generateSchedule();
  });
}

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = './subscriber-login.html';
});

// Menu
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');
menuBtn?.addEventListener('click', () => {
  menuDropdown?.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-box')) {
    menuDropdown?.classList.remove('show');
  }
});
