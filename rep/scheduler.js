// scheduler.js - 4-week route planner with drag-and-drop rescheduling and 28-day recurring cadence
import initMenuDropdown from "./menu.js";
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
  dayMessageCancel: document.getElementById("cancelDayMessage"),
  newTemplateSection: document.getElementById("newTemplateSection"),
  newTemplateName: document.getElementById("newTemplateName"),
  saveTemplate: document.getElementById("saveTemplate"),
  deleteTemplateSection: document.getElementById("deleteTemplateSection"),
  deleteTemplate: document.getElementById("deleteTemplate"),
  closeDayMessageModal: document.getElementById("closeDayMessageModal"),
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
  weeksVisible: INITIAL_WEEKS,
  selectedJobIds: new Set(),
  messageContext: null,
  cleanerFilter: "",
  customTemplates: [], // User-saved templates
};

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
    const quotesRef = collection(db, "quotes");
    const q = query(quotesRef, where("bookedDate", "!=", null));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }))
      .filter((quote) => !quote.deleted && quote.bookedDate);
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
    const weekEnd = addDays(weekStart, 4); // Mon–Fri
    const weekNumber = getCycleWeekNumber(weekStart);
    header.textContent = `Week ${weekNumber}: ${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    section.appendChild(header);
    const table = document.createElement("div");
    table.className = "schedule-table";
    // Only Monday–Friday
    for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
      const dayDate = addDays(weekStart, dayOffset);
      const isoKey = toIsoDate(dayDate);
      let entries = scheduleMap.get(isoKey) || [];
      // Stable order: use saved dayOrders if present; otherwise keep current order
      const entriesWithIndex = entries.map((e, i) => ({ ...e, _i: i }));
      entriesWithIndex.sort((a, b) => {
        const ao = (a.quote.dayOrders && a.quote.dayOrders[isoKey] != null) ? a.quote.dayOrders[isoKey] : a._i;
        const bo = (b.quote.dayOrders && b.quote.dayOrders[isoKey] != null) ? b.quote.dayOrders[isoKey] : b._i;
        return ao - bo;
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
              </div>
              <div class="job-meta">
                <span class="job-price">${price}</span>
                <span class="job-cleaner">${cleaner}</span>
              </div>
            </div>
            <div class="schedule-job__details" hidden>
              ${details}
            </div>
          `;
          jobsCell.appendChild(card);
        });
      }
  dayCard.appendChild(jobsCell);
      
  // Day footer with total and send button
      const dayFooter = document.createElement("div");
      dayFooter.className = "day-actions";

      const totalDiv = document.createElement("div");
      totalDiv.className = "day-total";
      totalDiv.textContent = `Total: ${formatCurrency(dayTotal)}`;
      dayFooter.appendChild(totalDiv);

      const actionsSelect = document.createElement("select");
      actionsSelect.className = "day-actions-select";
      actionsSelect.dataset.date = isoKey;
      actionsSelect.innerHTML = `
        <option value="">Day actions...</option>
        <option value="send">Send messages</option>
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

async function refreshData() {
  state.quotes = await fetchBookedQuotes();
  renderSchedule();
}

// Compute and persist a new order index for a quote within a day
async function reorderWithinDay(dateKey, draggedId, beforeId) {
  try {
    const scheduleMap = buildScheduleMap(state.startDate, state.weeksVisible);
    const entries = (scheduleMap.get(dateKey) || []).map((e, i) => ({
      id: e.quote.id,
      quote: e.quote,
      key: (e.quote.dayOrders && e.quote.dayOrders[dateKey] != null) ? e.quote.dayOrders[dateKey] : i * 1000,
    })).sort((a, b) => a.key - b.key);

    const targetIdx = entries.findIndex((x) => x.id === beforeId);
    if (targetIdx === -1) return false;
    const prevKey = targetIdx > 0 ? entries[targetIdx - 1].key : entries[targetIdx].key - 1000;
    const nextKey = entries[targetIdx].key;
    const newKey = (prevKey + nextKey) / 2;

    // Persist to Firestore
    const fieldPath = `dayOrders.${dateKey}`;
    await updateDoc(doc(db, "quotes", draggedId), { [fieldPath]: newKey });

    // Update local state
    const draggedQuote = state.quotes.find((q) => q.id === draggedId);
    if (draggedQuote) {
      if (!draggedQuote.dayOrders) draggedQuote.dayOrders = {};
      draggedQuote.dayOrders[dateKey] = newKey;
    }
    return true;
  } catch (error) {
    console.error("Failed to reorder within day", { dateKey, draggedId, beforeId }, error);
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
    if (!recipientEmail) {
      console.warn("No email for quote", quote.id);
      errors.push(`${quote.customerName || "Unknown"}: No email address`);
      continue;
    }
    const message = body.replace(/\[NAME\]/gi, quote.customerName || "Customer");
    try {
      await emailjs.send(EMAIL_SERVICE, EMAIL_TEMPLATE, {
        title: templateTitle,
        name: quote.customerName || "",
        message: message,
        email: recipientEmail,
      });
      sent += 1;
      if (elements.dayMessageProgress) {
        elements.dayMessageProgress.textContent = `Sent ${sent} of ${total}`;
      }
    } catch (error) {
      console.error("Failed to send day message", quote.id, error);
      errors.push(`${quote.customerName || "Unknown"}: ${error.message || "Send failed"}`);
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
      state.draggingIds = [job.dataset.id];
      state.dragOriginDate = job.dataset.date || null;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", job.dataset.id);
      job.classList.add("dragging");
    });

    elements.schedule.addEventListener("dragend", (event) => {
      const job = event.target.closest(".schedule-job");
      if (job) {
        job.classList.remove("dragging");
      }
      state.draggingIds = [];
      state.dragOriginDate = null;
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
      if (!row) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    elements.schedule.addEventListener("drop", async (event) => {
      event.preventDefault();
      const row = event.target.closest(".schedule-row");
      if (!row || !state.draggingIds.length) return;
      const dateKey = row.dataset.date;
      const quoteId = state.draggingIds[0];
      
      // If dropped within the same day onto a job, treat as re-order
      const targetJob = event.target.closest('.schedule-job');
      if (state.dragOriginDate && state.dragOriginDate === dateKey && targetJob && targetJob.dataset.id && targetJob.dataset.id !== quoteId) {
        const ok = await reorderWithinDay(dateKey, quoteId, targetJob.dataset.id);
        if (!ok) alert("Failed to reorder. Check console for details.");
        renderSchedule();
        return;
      }
      
      // Otherwise, treat as reschedule to another day
      const targetDate = new Date(`${dateKey}T00:00:00`);
      const success = await rescheduleQuote(quoteId, targetDate);
      if (success) {
        renderSchedule();
      } else {
        alert("Failed to reschedule. Check console for details.");
      }
    });

    elements.schedule.addEventListener("click", (event) => {
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
        
        if (action === "send" && dateKey) {
          openDayMessageModal(dateKey);
          // Reset dropdown after modal opens
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
  initMenuDropdown();
  initEmailJsScheduler();
  loadCustomTemplates();

  const baseline = new Date(`${BASELINE_START_DATE}T00:00:00`);
  state.startDate = normalizeStartDate(baseline);

  if (elements.startWeek) {
    elements.startWeek.value = BASELINE_START_DATE;
  }

  state.quotes = await fetchBookedQuotes();
  state.weeksVisible = INITIAL_WEEKS;
  state.draggingIds = [];
  clearSelectedJobs();

  if (elements.cleanerFilter) {
    populateCleanerSelect(elements.cleanerFilter, {
      includePlaceholder: true,
      placeholderLabel: "All cleaners",
      includeAll: true,
      includeUnassigned: true,
    });
  }

  renderSchedule();
  attachEvents();
  updateSelectionUI();
  updateShowNextWeekButton();
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

function buildJobDetailsHtml(quote) {
  const safe = (v) => escapeHtml(v ?? "—");
  const telRaw = quote.mobile || quote.phone || quote.contactNumber || "";
  const telDisplay = telRaw ? safe(telRaw) : "—";
  const telHref = telRaw ? formatTelHref(telRaw) : null;
  const emailRaw = quote.email || quote.customerEmail || "";
  const emailDisplay = emailRaw ? safe(emailRaw) : "—";
  const emailHref = emailRaw ? `mailto:${encodeURIComponent(String(emailRaw))}` : null;

  const rows = [
    ["Address", safe(quote.address)],
    ["Contact", telHref ? `<a href="${telHref}">${telDisplay}</a>` : telDisplay],
    ["Email", emailHref ? `<a href="${emailHref}">${emailDisplay}</a>` : emailDisplay],
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
  `;
}
