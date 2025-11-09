// Swash Admin Dashboard logic

// Loads quotes from Firestore, supports filtering, exports, email confirmations, and inline details.



import { app, auth, db } from "./firebase-init.js";
import { authStateReady, handlePageRouting } from "./auth-check.js";
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
const EMAIL_SERVICE = window.EMAIL_SERVICE_ID ?? "service_cdy739m";
const EMAIL_TEMPLATE = window.EMAIL_TEMPLATE_ID ?? "template_d8tlf1p";
const EMAIL_PUBLIC_KEY = "7HZRYXz3JmMciex1L";



const CLEANER_OPTIONS = Array.from({ length: 10 }, (_, index) => `Cleaner ${index + 1}`);
const CLEANER_ALL = "ALL";
const CLEANER_UNASSIGNED = "UNASSIGNED";

const syncChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("swash-quotes-sync") : null;
let syncReloadInProgress = false;
const SYNC_SOURCE = "admin";

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

function resolveCleanerUpdate(selection) {
  if (selection === undefined || selection === null || selection === "" || selection === CLEANER_ALL) {
    return { shouldUpdate: false };
  }
  if (selection === CLEANER_UNASSIGNED) {
    return { shouldUpdate: true, value: null };
  }
  return { shouldUpdate: true, value: selection };
}

function deriveCleanerPrefill(quotes = []) {
  if (!Array.isArray(quotes) || !quotes.length) return "";
  const unique = new Set(
    quotes.map((quote) => (quote.assignedCleaner ? quote.assignedCleaner : CLEANER_UNASSIGNED)),
  );
  if (unique.size === 1) {
    const [value] = unique;
    return value === CLEANER_UNASSIGNED ? CLEANER_UNASSIGNED : value;
  }
  return "";
}

function getCleanerDisplay(value) {
  return value ? value : "Unassigned";
}



const elements = {

  quotesBody: document.getElementById("quotesBody"),

  summaryTotal: document.getElementById("summaryTotal"),

  summaryAvg: document.getElementById("summaryAvg"),

  summaryUpfront: document.getElementById("summaryUpfront"),

  summaryCount: document.getElementById("summaryCount"),

  startDate: document.getElementById("startDate"),

  endDate: document.getElementById("endDate"),

  repFilter: document.getElementById("repFilter"),
  statusFilter: document.getElementById("statusFilter"),
  showSelectedOnly: document.getElementById("showSelectedOnly"),
  assignCleanerSelect: document.getElementById("assignCleanerSelect"),
  assignCleanerApply: document.getElementById("assignCleanerApply"),

  applyFilters: document.getElementById("applyFilters"),

  clearFilters: document.getElementById("clearFilters"),

  selectAll: document.getElementById("selectAll"),
  quotesCards: document.getElementById("quotesCards"),
  actionsDropdown: document.querySelector(".actions-dropdown"),
  actionsToggle: document.getElementById("actionsToggle"),
  actionsMenu: document.getElementById("actionsMenu"),
  actionButtons: Array.from(document.querySelectorAll("#actionsMenu [data-action]")),

  

  

  

  

  importModal: document.getElementById("importModal"),

  importFile: document.getElementById("importFile"),

  importConfirm: document.getElementById("importConfirm"),

  importCancel: document.getElementById("importCancel"),

  importStatus: document.getElementById("importStatus"),

  popupModal: document.getElementById("popupModal"),

  selectedRecipients: document.getElementById("selectedRecipients"),

  cleanDate: document.getElementById("cleanDate"),

  scheduleModal: document.getElementById("scheduleModal"),

  scheduleCustomerList: document.getElementById("scheduleCustomerList"),

  scheduleDate: document.getElementById("scheduleDate"),

  scheduleStatus: document.getElementById("scheduleStatus"),

  scheduleConfirm: document.getElementById("scheduleConfirm"),

  scheduleCancel: document.getElementById("scheduleCancel"),
  scheduleCleaner: document.getElementById("scheduleCleanerSelect"),

  emailPreview: document.getElementById("emailPreview"),

  confirmSend: document.getElementById("confirmSend"),
  emailCleaner: document.getElementById("emailCleanerSelect"),

  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),

  searchInput: document.getElementById("searchQuotes"),

  prevPageBtn: document.getElementById("prevPage"),

  nextPageBtn: document.getElementById("nextPage"),

  paginationInfo: document.getElementById("paginationInfo"),

  sendProgress: document.getElementById("sendProgress"),

  tableWrapper: document.querySelector(".table-wrapper"),

  authOverlay: document.getElementById("authOverlay"),

  loginForm: document.getElementById("loginForm"),

  loginEmail: document.getElementById("loginEmail"),

  loginPassword: document.getElementById("loginPassword"),

  loginError: document.getElementById("loginError"),

  logoutBtn: document.getElementById("logoutBtn"),

  selectedCustomersBox: document.getElementById("selectedCustomersBox"),
  selectedCustomersList: document.getElementById("selectedCustomersList"),

};



const state = {
  quotes: [],
  filtered: [],
  selectedIds: new Set(),
  visibleIds: new Set(),
  selectedForEmail: [],
  selectedForSchedule: [],
  currentPage: 1,
  pageSize: 25,
  showSelectedOnly: false,
  searchQuery: "",
  previewView: "desktop",
  actionsMenuOpen: false,
  assignCleaner: "",
  scheduleCleaner: "",
  emailCleaner: "",
  cleaners: [],
};

let adminAppInitialised = false;
let adminBootstrapRegistered = false;

function resolveCleanerLabel(data = {}, fallback = "") {
  const candidates = [
    typeof data === "string" ? data : "",
    data?.name,
    data?.displayName,
    data?.cleanerName,
    data?.label,
    data?.fullName,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  const resolved = match ? match.trim() : fallback;
  return resolved || "";
}

function uniqueCleanerList(values = []) {
  const set = new Set();
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    set.add(trimmed);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function populateCleanerSelect(target, options = {}) {
  if (!target) return;
  const {
    includePlaceholder = false,
    placeholderLabel = "Select cleaner",
    placeholderValue = "",
    includeAll = false,
    includeUnassigned = false,
    selectedValue,
    defaultValue = "",
  } = options;

  const cleaners = state.cleaners.length ? state.cleaners : CLEANER_OPTIONS;
  const uniqueCleaners = uniqueCleanerList(cleaners);
  const currentValue = selectedValue !== undefined ? selectedValue : target.value;

  const createOption = (value, label) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  };

  const fragment = document.createDocumentFragment();
  if (includePlaceholder) {
    fragment.appendChild(createOption(placeholderValue, placeholderLabel));
  }
  if (includeAll) {
    fragment.appendChild(createOption(CLEANER_ALL, "All cleaners"));
  }
  uniqueCleaners.forEach((label) => {
    fragment.appendChild(createOption(label, label));
  });
  if (includeUnassigned && !uniqueCleaners.includes(CLEANER_UNASSIGNED)) {
    fragment.appendChild(createOption(CLEANER_UNASSIGNED, "Unassigned"));
  }

  target.innerHTML = "";
  target.appendChild(fragment);

  const normalisedValue = currentValue && target.querySelector(`option[value="${currentValue}"]`)
    ? currentValue
    : defaultValue;
  if (normalisedValue !== undefined && normalisedValue !== null) {
    target.value = normalisedValue;
  }
}

export async function populateAllCleanerSelects() {
  try {
    const snap = await getDocs(collection(db, "cleaners"));
    const cleanersFromDb = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return resolveCleanerLabel(data, docSnap.id);
    });
    const resolved = uniqueCleanerList(cleanersFromDb.length ? cleanersFromDb : CLEANER_OPTIONS);
    state.cleaners = resolved.length ? resolved : [...CLEANER_OPTIONS];
  } catch (error) {
    const quoteCleaners = state.quotes
      .map((quote) => resolveCleanerLabel(quote?.assignedCleaner || "", ""))
      .filter(Boolean);
    const fallback = uniqueCleanerList([...CLEANER_OPTIONS, ...quoteCleaners]);
    state.cleaners = fallback.length ? fallback : [...CLEANER_OPTIONS];
    if (error?.code === "permission-denied") {
      console.warn(
        "[Admin] Cleaners collection requires read access. Using inferred cleaner list from quotes instead.",
        error,
      );
      console.warn(
        "[Admin] Check Firestore security rules to ensure admins can read the `cleaners` collection or create the collection with the expected documents.",
      );
    } else {
      console.error("[Admin] Failed to load cleaners list, falling back to defaults", error);
    }
  }

  const targets = new Set([
    elements.assignCleanerSelect,
    elements.scheduleCleaner,
    elements.emailCleaner,
  ]);
  targets.forEach((target) => {
    if (!target) return;
    populateCleanerSelect(target, {
      includePlaceholder: true,
      placeholderLabel:
        target === elements.assignCleanerSelect ? "Select cleaner" : "Keep current",
      includeUnassigned: true,
      selectedValue:
        target === elements.assignCleanerSelect
          ? state.assignCleaner
          : target === elements.scheduleCleaner
            ? state.scheduleCleaner
            : state.emailCleaner,
    });
  });

  console.log("[Admin] populateAllCleanerSelects OK");
}



function showAuthOverlay(show) {
  if (!elements.authOverlay) return;
  elements.authOverlay.hidden = !show;
  elements.authOverlay.style.display = show ? "flex" : "none";
  if (show) {
    elements.loginError?.setAttribute("hidden", "hidden");
  }
}

function setLoginError(message) {
  if (!elements.loginError) return;
  elements.loginError.textContent = message;
  elements.loginError.hidden = !message;
}

function clearLoginError() {
  setLoginError("");
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (!elements.loginEmail || !elements.loginPassword) return;
  const email = elements.loginEmail.value.trim();
  const password = elements.loginPassword.value;
  if (!email || !password) {
    setLoginError("Enter your email address and password.");
    return;
  }
  clearLoginError();
  const submitButton = elements.loginForm?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    elements.loginForm?.reset();
  } catch (error) {
    const code = error?.code || "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
      setLoginError("Email or password is incorrect.");
    } else if (code === "auth/user-not-found") {
      setLoginError("Account not found. Contact an administrator.");
    } else {
      setLoginError(error?.message || "Sign in failed. Please try again.");
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Sign in";
    }
  }
}

function setupAuthUi() {
  elements.loginForm?.addEventListener("submit", handleLoginSubmit);
  elements.loginEmail?.addEventListener("input", clearLoginError);
  elements.loginPassword?.addEventListener("input", clearLoginError);
  elements.logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Sign out failed", error);
    }
  });
}

function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

function setSendProgress(sent, total) {

  const target = elements.sendProgress;

  if (!target) return;

  if (!total) {

    target.textContent = "";

    target.style.visibility = "hidden";

    return;

  }

  target.textContent = `${sent} of ${total} sent`;

  target.style.visibility = "visible";

}




function resolveQuoteEmail(source = {}) {

  const candidates = [

    source.email,

    source.customerEmail,

    source.contactEmail,

    source.contact?.email,

    source.customer?.email,

    source.customerDetails?.email,

    source.customer_email,

    source.customerEmailAddress,

    source.emailAddress,

    source.primaryEmail,

  ];

  const direct = candidates.find((value) => typeof value === "string" && value.trim());

  if (direct && direct.includes("@")) {

    return direct.trim();

  }

  const visited = new Set();

  const search = (value) => {

    if (!value) return "";

    if (typeof value === "string") {

      const trimmed = value.trim();

      return trimmed && trimmed.includes("@") ? trimmed : "";

    }

    if (typeof value !== "object" || visited.has(value)) return "";

    visited.add(value);

    for (const key of Object.keys(value)) {

      const found = search(value[key]);

      if (found) return found;

    }

    return "";

  };

  return search(source);

}



function getEmailTemplateMeta(quote) {

  const planLabel = String(quote.tier || "Silver").toLowerCase() === "gold" ? "Gold" : "Silver";

  const extras = [];

  if (toBoolean(quote.conservatory)) extras.push("Conservatory");

  if (toBoolean(quote.extension)) extras.push("Extension");

  const roofLanternCount = Number(quote.roofLanterns || 0);

  if (roofLanternCount) {

    extras.push(`${roofLanternCount} ${roofLanternCount === 1 ? "roof lantern" : "roof lanterns"}`);

  }

  const skylightCount = Number(quote.skylights || 0);

  const extrasLabel = extras.length ? extras.join(", " ) : "Standard clean";

  return { planLabel, extrasLabel, skylightCount };

}


function resolvePricePerClean(quote) {

  const candidates = [
    quote.pricePerClean,
    quote.price_per_clean,
    quote.pricePerCleanIncVat,
    quote.pricePerCleanWithVat,
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

function resolveStatusCategory(quote) {
  const statusText = String(quote.status || "").toLowerCase();
  if (statusText.includes("cancel") || statusText.includes("archiv")) return "CANCELLED";
  if (statusText.includes("booked")) return "BOOKED";
  return "NEEDS_BOOKING";
}

if (typeof window !== "undefined") {
  window.resolveStatusCategory = resolveStatusCategory;
}

function formatCurrency(value) {

  const number = Number(value || 0);

  return `\u00A3${number.toFixed(2)}`;

}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}



function parseDate(input) {

  if (!input) return null;

  if (typeof input.toDate === "function") return input.toDate();

  const date = new Date(input);

  return Number.isNaN(date.getTime()) ? null : date;

}



function formatDate(input) {

  const date = parseDate(input);

  return date ? date.toLocaleDateString("en-GB") : "";

}



function delay(ms) {

  return new Promise((resolve) => setTimeout(resolve, ms));

}



function formatTime(input) {

  const date = parseDate(input);

  return date ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

}



function addDays(date, days) {

  const base = new Date(date);

  base.setDate(base.getDate() + days);

  return base;

}

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#39;');

}

function generateReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let index = 0; index < 6; index += 1) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

function normaliseEmailValue(value) {
  if (value == null) return "";
  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(/[<>(),;:"[\]]/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(cleaned) ? cleaned : "";
}

function parseNumeric(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return fallback;
  const cleaned = String(value).trim();
  if (!cleaned) return fallback;
  const numeric = Number(cleaned.replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned.replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseCsvText(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && input[i + 1] === "\n") {
        i += 1;
      }
      current.push(value);
      rows.push(current);
      current = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV format error: unmatched quote detected.");
  }

  if (value.length || current.length) {
    current.push(value);
    rows.push(current);
  }

  return rows.filter((row) => row.some((cell) => cell && cell.length));
}

function mapCsvRowsToObjects(rows) {
  if (!rows.length) {
    throw new Error("CSV file is empty.");
  }
  const headerRow = rows[0].map((header) => header.trim().toLowerCase());
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const record = {};
    headerRow.forEach((header, index) => {
      if (!header) return;
      record[header] = (cells[index] ?? "").trim();
    });
    record.__rowNumber = i + 1;
    if (!Object.values(record).every((value) => (value ?? "").trim() === "")) {
      records.push(record);
    }
  }
  if (!records.length) {
    throw new Error("CSV contains no data rows.");
  }
  return records;
}

function normaliseTier(value) {
  const formatted = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (formatted === "gold" || formatted === "silver" || formatted === "gold-for-silver") {
    return formatted;
  }
  return "silver";
}

function buildQuoteFromCsvRow(row, rowNumber) {
  const get = (key) => (row[key] ?? "").trim();
  const warnings = [];

  const ensureValue = (value, label, fallback = "N/A") => {
    if (value) return value;
    warnings.push(`Row ${rowNumber}: ${label} missing (set to ${fallback}).`);
    return fallback;
  };

  const customerName = ensureValue(get("customername"), "customerName");
  let email = normaliseEmailValue(get("email"));
  if (!email) {
    email = "N/A";
    warnings.push(`Row ${rowNumber}: email invalid or missing (set to N/A).`);
  }

  const tier = normaliseTier(get("tier"));
  const partialCleaningRaw = parseNumeric(get("partialcleaning"), 100);
  const partialCleaning =
    Number.isFinite(partialCleaningRaw) && partialCleaningRaw > 0 ? partialCleaningRaw : 100;
  if (partialCleaningRaw !== partialCleaning) {
    warnings.push(`Row ${rowNumber}: partialCleaning invalid (defaulted to 100).`);
  }

  const pricePerClean = parseNumeric(get("priceperclean"), 0);
  const price = parseNumeric(get("price"), 0);
  const latitude = parseCoordinate(get("customerlatitude"));
  const longitude = parseCoordinate(get("customerlongitude"));
  if (latitude == null) {
    warnings.push(`Row ${rowNumber}: customerLatitude missing or invalid (stored as null).`);
  }
  if (longitude == null) {
    warnings.push(`Row ${rowNumber}: customerLongitude missing or invalid (stored as null).`);
  }

  const quote = {
    repCode: "CSV",
    date: new Date().toISOString(),
    customerName,
    address: ensureValue(get("address"), "address"),
    mobile: ensureValue(get("mobile"), "mobile"),
    email,
    tier,
    houseType: ensureValue(get("housetype"), "houseType"),
    houseSize: ensureValue(get("housesize"), "houseSize"),
    extension: toBoolean(get("extension")),
    conservatory: toBoolean(get("conservatory")),
    skylights: Math.max(0, Math.round(parseNumeric(get("skylights"), 0))),
    roofLanterns: Math.max(0, Math.round(parseNumeric(get("rooflanterns"), 0))),
    partialCleaning,
    alternating: toBoolean(get("alternating")),
    pricePerClean,
    price,
    refCode: generateReference(),
    status: "Pending Payment",
    customerLatitude: latitude,
    customerLongitude: longitude,
    notes: get("notes"),
  };

  return { quote, warnings };
}

function formatScheduleDate(date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildSchedulePlan(firstClean) {
  const initial = new Date(firstClean);
  initial.setHours(0, 0, 0, 0);
  const second = addDays(initial, 28);
  const third = addDays(initial, 56);
  return {
    firstDate: initial,
    firstLabel: formatScheduleDate(initial),
    secondDate: second,
    thirdDate: third,
    nextCleanDates: [second.toISOString(), third.toISOString()],
  };
}

function setImportStatus(message = "", isError = false) {
  if (!elements.importStatus) return;
  elements.importStatus.textContent = message;
  elements.importStatus.style.color = isError ? "var(--swash-red)" : "var(--text-muted)";
}

function setScheduleStatus(message = "", isError = false) {
  if (!elements.scheduleStatus) return;
  elements.scheduleStatus.textContent = message;
  elements.scheduleStatus.style.color = isError ? "var(--swash-red)" : "var(--text-muted)";
}

function openImportModal() {
  if (!elements.importModal) return;
  setImportStatus("");
  if (elements.importFile) {
    elements.importFile.value = "";
  }
  elements.importModal.hidden = false;
  elements.importModal.style.display = "flex";
}

function closeImportModal() {
  if (!elements.importModal) return;
  elements.importModal.hidden = true;
  elements.importModal.style.display = "none";
  setImportStatus("");
  if (elements.importFile) {
    elements.importFile.value = "";
  }
}

async function handleImportConfirm() {
  if (!elements.importFile || !elements.importConfirm) return;
  const file = elements.importFile.files?.[0];
  if (!file) {
    setImportStatus("Select a CSV file to import.", true);
    return;
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    setImportStatus("Only .csv files are supported.", true);
    return;
  }

  try {
    elements.importConfirm.disabled = true;
    setImportStatus("Importing customersâ€¦");
    const text = await file.text();
    const rows = parseCsvText(text);
    const records = mapCsvRowsToObjects(rows);

    const quotesCollection = collection(db, "quotes");
    let successCount = 0;
    const failures = [];
    const warnings = [];

    for (const record of records) {
      const rowNumber = record.__rowNumber || 0;
      try {
        const { quote, warnings: rowWarnings } = buildQuoteFromCsvRow(record, rowNumber);
        await addDoc(quotesCollection, {
          ...quote,
          createdAt: serverTimestamp(),
        });
        successCount += 1;
        if (rowWarnings.length) {
          warnings.push(...rowWarnings);
        }
      } catch (error) {
        failures.push(`Row ${rowNumber}: ${error.message}`);
        console.warn("CSV import skipped row", rowNumber, error);
      }
    }

    if (successCount === 0) {
      if (failures.length) {
        const details = failures.join("\n");
        setImportStatus(
          `No customers were imported. Check the CSV data and try again.\n\nSkipped rows:\n${details}`,
          true,
        );
      } else {
        setImportStatus("No customers were imported. Check the CSV data and try again.", true);
      }
      if (failures.length) {
        console.warn("CSV import failures:", failures);
      }
      return;
    }

    closeImportModal();
    notifyQuotesUpdated();
    await loadQuotes();

    let message = `${successCount} customer${successCount === 1 ? "" : "s"} imported successfully.`;
    if (failures.length) {
      console.warn("CSV import failures:", failures);
      message += `\n\nSkipped rows:\n${failures.join("\n")}`;
    }
    if (warnings.length) {
      console.warn("CSV import warnings:", warnings);
      message += `\n\nWarnings:\n${warnings.join("\n")}`;
    }
    alert(message);
  } catch (error) {
    console.error("Import failed", error);
    setImportStatus(error.message || "Import failed. Check console for details.", true);
  } finally {
    if (elements.importConfirm) {
      elements.importConfirm.disabled = false;
    }
  }
}

function openScheduleModal() {
  const selected = state.selectedForEmail.length ? state.selectedForEmail : getSelectedQuotes();
  if (!selected.length) {
    alert("Select at least one quote to add to the schedule.");
    return;
  }

  state.selectedForSchedule = selected;
  state.selectedForEmail = selected;
  populateCleanerSelect(elements.scheduleCleaner, {
    includePlaceholder: true,
    placeholderLabel: "Keep current",
    includeUnassigned: true,
  });
  if (elements.scheduleCleaner) {
    let prefill = state.scheduleCleaner || deriveCleanerPrefill(selected);
    if (prefill && !elements.scheduleCleaner.querySelector(`option[value="${prefill}"]`)) {
      prefill = "";
    }
    elements.scheduleCleaner.value = prefill || "";
    state.scheduleCleaner = elements.scheduleCleaner.value || "";
  }
  if (elements.scheduleCustomerList) {
    elements.scheduleCustomerList.innerHTML = selected
      .map((quote) => {
        const name = escapeHtml(quote.customerName || "N/A");
        const address = escapeHtml(quote.address || "N/A");
        const price = formatCurrency(resolvePricePerClean(quote));
        return `<li><strong>${name}</strong> — ${address} — ${price}</li>`;
      })
      .join("");
  }

  const defaultDate = elements.cleanDate?.value || new Date().toISOString().slice(0, 10);
  if (elements.scheduleDate) {
    elements.scheduleDate.value = defaultDate;
  }
  setScheduleStatus("");
  setSendProgress(0, 0);
  if (elements.scheduleModal) {
    elements.scheduleModal.hidden = false;
    elements.scheduleModal.style.display = "flex";
  }
  elements.scheduleDate?.focus();
}

function closeScheduleModal() {
  if (!elements.scheduleModal) return;
  elements.scheduleModal.hidden = true;
  elements.scheduleModal.style.display = "none";
  setScheduleStatus("");
  if (elements.scheduleCustomerList) {
    elements.scheduleCustomerList.innerHTML = "";
  }
  setSendProgress(0, 0);
  state.selectedForSchedule = [];
}

async function scheduleCustomers(quotes, firstClean, cleanerSelection = "") {
  const schedulePlan = buildSchedulePlan(firstClean);
  const total = quotes.length;
  let processed = 0;
  let successes = 0;
  const failures = [];
  const cleanerUpdate = resolveCleanerUpdate(cleanerSelection);

  for (const quote of quotes) {
    try {
      const payload = {
        status: `Booked - ${schedulePlan.firstLabel}`,
        bookedDate: schedulePlan.firstDate.toISOString(),
        nextCleanDates: schedulePlan.nextCleanDates,
      };
      if (cleanerUpdate.shouldUpdate) {
        payload.assignedCleaner = cleanerUpdate.value;
      }
      await updateDoc(doc(db, "quotes", quote.id), payload);
      Object.assign(quote, payload);
      updateLocalQuote(quote.id, payload);
      successes += 1;
    } catch (error) {
      console.error("Failed to schedule quote", quote.id, error);
      const label = quote.customerName || quote.address || quote.refCode || quote.id;
      failures.push(`${label}: ${error.message || "Update failed"}`);
    } finally {
      processed += 1;
      setScheduleStatus(`Scheduling ${processed} of ${total}...`);
    }
  }

  await loadQuotes();
  if (successes) {
    notifyQuotesUpdated();
  }

  return { successes, failures, schedulePlan };
}

async function handleScheduleConfirm() {
  if (!state.selectedForSchedule.length) {
    closeScheduleModal();
    return;
  }

  const value = elements.scheduleDate?.value?.trim();
  if (!value) {
    setScheduleStatus("Select a date before adding to the schedule.", true);
    elements.scheduleDate?.focus();
    return;
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    setScheduleStatus("Enter a valid date.", true);
    elements.scheduleDate?.focus();
    return;
  }

  const cleanerSelection = elements.scheduleCleaner?.value || "";
  state.scheduleCleaner = cleanerSelection;

  elements.scheduleConfirm.disabled = true;
  elements.scheduleCancel.disabled = true;
  setScheduleStatus("Scheduling customers...");

  try {
    const { successes, failures, schedulePlan } = await scheduleCustomers(
      state.selectedForSchedule,
      parsed,
      cleanerSelection,
    );

    if (elements.cleanDate) {
      elements.cleanDate.value = value;
    }

    if (successes === 0) {
      setScheduleStatus(
        failures.length
          ? `No customers were scheduled. Issues:\n${failures.join("\n")}`
          : "No customers were scheduled.",
        true,
      );
      setSendProgress(0, 0);
      return;
    }

    closeScheduleModal();

    setSendProgress(0, 0);

    let message = `${successes} customer${successes === 1 ? "" : "s"} added to the schedule.`;
    if (schedulePlan?.firstLabel) {
      message += `\nFirst clean date: ${schedulePlan.firstLabel}`;
    }
    if (failures.length) {
      message += `\n\nFailed:\n${failures.join("\n")}`;
    }
    alert(message);
  } catch (error) {
    console.error("Scheduling failed", error);
    setScheduleStatus(error.message || "Failed to add customers. Try again.", true);
  } finally {
    elements.scheduleConfirm.disabled = false;
    elements.scheduleCancel.disabled = false;
  }
}
function formatYesNo(value) {

  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return normalised === "true" || normalised === "yes" || normalised === "1" ? "Yes" : "No";
  }

  return value ? "Yes" : "No";

}

function toBoolean(value) {

  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (!normalised) return false;
    return normalised === "true" || normalised === "yes" || normalised === "1";
  }

  return Boolean(value);

}

function normaliseQuote(docSnap) {

  const data = docSnap.data();

  const created = parseDate(data.createdAt) || parseDate(data.date);

  return {

    id: docSnap.id,

    ...data,

    email: resolveQuoteEmail(data),

    date: created ? created.toISOString() : data.date || "",

  };

}



function sortQuotes(quotes) {

  return [...quotes].sort((a, b) => {

    const da = parseDate(a.date)?.getTime() || 0;

    const db = parseDate(b.date)?.getTime() || 0;

    return db - da;

  });

}



function filterQuotes() {

  const start = elements.startDate?.value ? new Date(elements.startDate.value) : null;

  const end = elements.endDate?.value ? new Date(elements.endDate.value) : null;

  const repSelection = elements.repFilter?.value || "ALL";

  const statusSelection = elements.statusFilter?.value || "ALL";



  const filtered = state.quotes.filter((quote) => {

    const date = parseDate(quote.date);

    if (!date) return true;

    if (start && date < start) return false;

    if (end) {

      const endOfDay = new Date(end);

      endOfDay.setHours(23, 59, 59, 999);

      if (date > endOfDay) return false;

    }

    if (repSelection !== "ALL") {

      const repCode = String(quote.repCode || "").trim().toUpperCase();

      if (repCode !== repSelection) return false;

    }

    if (statusSelection !== "ALL") {

      const category = resolveStatusCategory(quote);

      if (statusSelection === "BOOKED" && category !== "BOOKED") return false;

      if (statusSelection === "CANCELLED" && category !== "CANCELLED") return false;

      if (statusSelection === "NEEDS_BOOKING" && category !== "NEEDS_BOOKING") return false;

    }

    return true;

  });



  state.filtered = sortQuotes(filtered);
  state.currentPage = 1;

  render();

}



function renderSummary() {

  const list = state.filtered;

  const count = list.length;

  const totalUpfront = list.reduce((sum, quote) => sum + Number(quote.price || 0), 0);

  const averagePrice = count ? totalUpfront / count : 0;

  const averageUpfront = count

    ? list.reduce((sum, quote) => sum + resolvePricePerClean(quote) * 3, 0) / count

    : 0;



  if (elements.summaryTotal) {

    elements.summaryTotal.textContent = `Total ${formatCurrency(totalUpfront)}`;

  }

  if (elements.summaryAvg) {

    elements.summaryAvg.textContent = `Avg Price: ${formatCurrency(averagePrice)}`;

  }

  if (elements.summaryUpfront) {

    elements.summaryUpfront.textContent = `Avg Upfront: ${formatCurrency(averageUpfront)}`;

  }

  if (elements.summaryCount) {

    elements.summaryCount.textContent = `Count: ${count}`;

  }

}

function applySearch(list) {

  const query = state.searchQuery.trim().toLowerCase();

  if (!query) return list;

  return list.filter((quote) => {

    const haystack = [

      quote.customerName,

      quote.address,

      quote.email,

      quote.mobile,

      quote.refCode,

      quote.repCode,

      quote.notes,

      quote.tier,

      quote.status,

    ]

      .filter(Boolean)

      .join(" ")

      .toLowerCase();

    return haystack.includes(query);

  });

}

function getPaginationSnapshot() {

  const baseList = state.showSelectedOnly

    ? state.filtered.filter((quote) => state.selectedIds.has(quote.id))

    : state.filtered;

  const searched = applySearch(baseList);

  const totalItems = searched.length;

  const totalPages = totalItems ? Math.ceil(totalItems / state.pageSize) : 1;

  if (state.currentPage > totalPages) state.currentPage = totalPages;

  if (state.currentPage < 1) state.currentPage = 1;

  const startIndex = totalItems ? (state.currentPage - 1) * state.pageSize : 0;

  const pageItems = searched.slice(startIndex, startIndex + state.pageSize);

  return { pageItems, totalItems, totalPages, startIndex };

}

function updatePaginationControls(totalItems, totalPages, startIndex) {

  if (!elements.paginationInfo || !elements.prevPageBtn || !elements.nextPageBtn) return;

  const hasItems = totalItems > 0;

  const start = hasItems ? startIndex + 1 : 0;

  const end = hasItems ? Math.min(totalItems, startIndex + state.pageSize) : 0;

  elements.paginationInfo.textContent = hasItems

    ? `Showing ${start}-${end} of ${totalItems} quote${totalItems === 1 ? "" : "s"} (Page ${state.currentPage} of ${totalPages})`

    : "No quotes to display";

  elements.prevPageBtn.disabled = state.currentPage <= 1;

  elements.nextPageBtn.disabled = !hasItems || state.currentPage >= totalPages;

}

function renderTable(list) {

  if (!elements.quotesBody) return;

  if (!list.length) {

    elements.quotesBody.innerHTML = '<tr><td colspan="9">No quotes found for the current view.</td></tr>';

    return;

  }

  const fragment = document.createDocumentFragment();

  list.forEach((quote) => {
    const row = document.createElement("tr");
    row.dataset.id = quote.id;
    row.classList.add("quote-row");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-expanded", "false");
    const statusText = String(quote.status || "Pending Payment");
    const statusCategory = resolveStatusCategory(quote);
    if (statusCategory === "CANCELLED") {
      row.classList.add("status-cancelled");
    } else if (statusCategory === "BOOKED") {
      row.classList.add("status-booked");
      row.classList.add("booked");
    } else if (statusCategory === "NEEDS_BOOKING") {
      row.classList.add("status-pending");
    }

    const customerName = escapeHtml(quote.customerName || "");

    const address = escapeHtml(quote.address || "");

    const repCodeDisplay = escapeHtml((quote.repCode || "").toString().trim().toUpperCase() || "-");

    const phoneHtml = quote.mobile

      ? `<span class="contact-phone">${escapeHtml(quote.mobile)}</span>`

      : `<span class="contact-missing">No phone</span>`;

    const emailHtml = quote.email

      ? `<span class="contact-email">${escapeHtml(quote.email)}</span>`

      : `<span class="contact-missing">No email</span>`;

    const dateHtml = formatDate(quote.date);

    const timeHtml = formatTime(quote.date);

    const timeBlock = timeHtml ? `<div class="quote-time">Time Submitted: ${timeHtml}</div>` : "";

    const isChecked = state.selectedIds.has(quote.id);
    const cleanerLabel = escapeHtml(getCleanerDisplay(quote.assignedCleaner));

    row.innerHTML = `

      <td class="checkbox-cell"><input type="checkbox" data-id="${quote.id}"${isChecked ? " checked" : ""} /></td>

      <td>${repCodeDisplay}</td>

      <td>${dateHtml}${timeBlock}</td>

      <td>${customerName}</td>

      <td>${address}</td>

      <td>${cleanerLabel}</td>

      <td><div class="contact-info">${phoneHtml}${emailHtml}</div></td>

      <td>${formatCurrency(resolvePricePerClean(quote))}</td>

      <td>${formatCurrency(quote.price)}</td>

    `;

    fragment.appendChild(row);

  });

  elements.quotesBody.innerHTML = "";

  elements.quotesBody.appendChild(fragment);

}

function render() {

  const { pageItems, totalItems, totalPages, startIndex } = getPaginationSnapshot();

  renderTable(pageItems);
  renderCards(pageItems);

  renderSummary();

  updatePaginationControls(totalItems, totalPages, startIndex);

  state.visibleIds = new Set(pageItems.map((quote) => quote.id));

  syncSelectionCheckboxes();
  syncSelectAllState();
  renderSelectedCustomersBox();

}

function toggleDetailRow(row, quote) {

  if (!elements.quotesBody || !row) return;

  const wasOpen = row.getAttribute("aria-expanded") === "true";

  elements.quotesBody.querySelectorAll(".details-row").forEach((details) => details.remove());

  elements.quotesBody.querySelectorAll(".quote-row").forEach((listRow) => {
    listRow.setAttribute("aria-expanded", "false");
    listRow.classList.remove("quote-row-hidden");
  });

  elements.tableWrapper?.classList.remove("details-open");

  if (wasOpen) {
    return;
  }

  const columnCount =
    row.children?.length ||
    elements.quotesBody.querySelector("tr")?.children.length ||
    1;

  const detailsRow = buildDetailsRow(quote, columnCount);

  elements.quotesBody.insertBefore(detailsRow, row.nextSibling);

  row.setAttribute("aria-expanded", "true");
  row.classList.add("quote-row-hidden");
  elements.tableWrapper?.classList.add("details-open");

  setupDetailForm(detailsRow, quote, row);

}

function renderSelectedRecipients() {

  const container =

    elements.selectedRecipients || document.getElementById("selectedRecipients");

  if (!container) return;

  elements.selectedRecipients = container;

  const selected = state.selectedForEmail;

  if (!selected.length) {

    container.innerHTML =

      '<strong>No recipients selected</strong><p class="text-muted" style="margin:4px 0 0;">Pick at least one quote to send booking confirmations.</p>';

    return;

  }

  const listItems = selected
    .map((quote) => {
      const name = escapeHtml(quote.customerName || "Unknown customer");
      const emailRaw =
        quote.email || quote.customerEmail || quote.contactEmail || "";
      const email = emailRaw ? escapeHtml(emailRaw) : "";
      const address = quote.address ? escapeHtml(quote.address) : "";
      const emailPart = email ? ` <span class="selected-email">${email}</span>` : "";
      const addressPart = address ? `<div class="selected-address">${address}</div>` : "";
      return `<li><strong>${name}</strong>${emailPart}${addressPart}</li>`;
    })
    .join("");

  const countLabel = selected.length === 1 ? "recipient" : "recipients";

  container.innerHTML = `

    <strong>${selected.length} ${countLabel} selected</strong>

    <ul>

      ${listItems}

    </ul>

  `;

}

function openModal() {

  if (!elements.popupModal) return;

  elements.popupModal.style.display = "flex";

  elements.popupModal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";

}

function closeModal() {

  if (!elements.popupModal) return;

  elements.popupModal.style.display = "none";

  elements.popupModal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";

  setSendProgress(0, 0);

}



function getSelectionCheckboxes() {
  const outputs = [];
  const tableCheckboxes =
    elements.quotesBody?.querySelectorAll('input[type="checkbox"][data-id]') ?? [];
  const cardCheckboxes =
    elements.quotesCards?.querySelectorAll('input[type="checkbox"][data-id]') ?? [];
  outputs.push(...tableCheckboxes);
  outputs.push(...cardCheckboxes);
  return outputs;
}

function renderCards(list) {
  if (!elements.quotesCards) return;
  const container = elements.quotesCards;
  if (!list.length) {
    container.innerHTML = '<p class="quotes-cards__empty">No quotes found for the current view.</p>';
    return;
  }
  const cards = list
    .map((quote) => {
      const repCodeDisplay = escapeHtml((quote.repCode || "").toString().trim().toUpperCase() || "-");
      const customerName = escapeHtml(quote.customerName || "Unknown customer");
      const address = escapeHtml(quote.address || "No address supplied");
      const phone = quote.mobile ? escapeHtml(quote.mobile) : "";
      const email = quote.email ? escapeHtml(quote.email) : "";
      const cleanerLabel = escapeHtml(getCleanerDisplay(quote.assignedCleaner));
      const perClean = formatCurrency(resolvePricePerClean(quote));
      const upfront = formatCurrency(quote.price ?? 0);
      const statusTextRaw = String(quote.status || "Pending Payment");
      const statusText = escapeHtml(statusTextRaw);
      const statusCategory = resolveStatusCategory(quote);
      const dateDisplay = formatDate(quote.date);
      const timeDisplay = formatTime(quote.date);
      const checkedAttr = state.selectedIds.has(quote.id) ? " checked" : "";
      const cardClass =
        statusCategory === "BOOKED"
          ? "quote-card--booked"
          : statusCategory === "CANCELLED"
            ? "quote-card--cancelled"
            : statusCategory === "NEEDS_BOOKING"
              ? "quote-card--needs-booking"
              : "";
      const contactBlock = [
        phone
          ? `<a href="tel:${phone}" class="quote-card__contact">${phone}</a>`
          : '<span class="quote-card__contact quote-card__contact--missing">No phone</span>',
        email
          ? `<a href="mailto:${email}" class="quote-card__contact">${email}</a>`
          : '<span class="quote-card__contact quote-card__contact--missing">No email</span>',
      ].join("");
      const pillClass =
        statusCategory === "BOOKED"
          ? "quote-card__status-pill--booked"
          : statusCategory === "CANCELLED"
            ? "quote-card__status-pill--cancelled"
            : "quote-card__status-pill--needs-booking";
      return `
        <article class="quote-card ${cardClass}" data-id="${quote.id}">
          <div class="quote-card__header">
            <label class="quote-card__checkbox">
              <input type="checkbox" data-id="${quote.id}"${checkedAttr} />
              <span>Select</span>
            </label>
            <div class="quote-card__header-meta">
              <span class="quote-card__status-pill ${pillClass}">${statusText}</span>
              <div class="quote-card__ref">${escapeHtml(quote.refCode || "N/A")}</div>
            </div>
          </div>
          <div class="quote-card__body">
            <div class="quote-card__row">
              <span class="quote-card__label">Rep</span>
              <span class="quote-card__value">${repCodeDisplay}</span>
            </div>
            <div class="quote-card__row">
              <span class="quote-card__label">Customer</span>
              <span class="quote-card__value">${customerName}</span>
            </div>
            <div class="quote-card__row">
              <span class="quote-card__label">Address</span>
              <span class="quote-card__value">${address}</span>
            </div>
            <div class="quote-card__row quote-card__row--contact">
              <span class="quote-card__label">Contact</span>
              <span class="quote-card__value">${contactBlock}</span>
            </div>
            <div class="quote-card__row">
              <span class="quote-card__label">Cleaner</span>
              <span class="quote-card__value">${cleanerLabel}</span>
            </div>
            <div class="quote-card__row">
              <span class="quote-card__label">Quote date</span>
              <span class="quote-card__value">${dateDisplay}${timeDisplay ? `<span class="quote-card__time">${timeDisplay}</span>` : ""}</span>
            </div>
            <div class="quote-card__row quote-card__row--pricing">
              <div>
                <span class="quote-card__label">Per clean</span>
                <span class="quote-card__value">${perClean}</span>
              </div>
              <div>
                <span class="quote-card__label">Upfront</span>
                <span class="quote-card__value">${upfront}</span>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  container.innerHTML = cards;
}
function getSelectedIds() {
  return Array.from(state.selectedIds);
}

function getSelectedQuotes() {
  if (!state.selectedIds.size) return [];
  const selectedSet = state.selectedIds;
  return state.quotes.filter((quote) => selectedSet.has(quote.id));
}

function renderSelectedCustomersBox() {
  if (!elements.selectedCustomersBox || !elements.selectedCustomersList) return;

  const selected = getSelectedQuotes();

  if (selected.length === 0) {
    elements.selectedCustomersBox.classList.add("hidden");
    return;
  }

  elements.selectedCustomersBox.classList.remove("hidden");

  const html = selected
    .map((quote) => {
      const name = quote.customerName || "Unknown";
      const address = quote.address || "No address";
      return `
        <div class="selected-customer-item">
          <div class="selected-customer-item__name">${escapeHtml(name)}</div>
          <div class="selected-customer-item__address">${escapeHtml(address)}</div>
        </div>
      `;
    })
    .join("");

  elements.selectedCustomersList.innerHTML = html;
}

function syncSelectAllState() {
  if (!elements.selectAll) return;
  const visibleIds = Array.from(state.visibleIds || []);
  if (!visibleIds.length) {
    elements.selectAll.checked = false;
    elements.selectAll.indeterminate = false;
    return;
  }
  let selectedCount = 0;
  visibleIds.forEach((id) => {
    if (state.selectedIds.has(id)) selectedCount += 1;
  });
  elements.selectAll.checked = selectedCount === visibleIds.length;
  elements.selectAll.indeterminate =
    selectedCount > 0 && selectedCount < visibleIds.length;
}

function syncSelectionCheckboxes() {
  getSelectionCheckboxes().forEach((checkbox) => {
    const id = checkbox.dataset.id;
    if (!id) return;
    checkbox.checked = state.selectedIds.has(id);
  });
}

function syncMirroredCheckboxes(targetId, checked, origin) {
  getSelectionCheckboxes().forEach((checkbox) => {
    if (checkbox === origin) return;
    if (checkbox.dataset.id === targetId) {
      checkbox.checked = checked;
    }
  });
}

function pruneSelectedIds() {
  const validIds = new Set(state.quotes.map((quote) => quote.id));
  state.selectedIds.forEach((id) => {
    if (!validIds.has(id)) {
      state.selectedIds.delete(id);
    }
  });
  if (!state.selectedIds.size && state.showSelectedOnly) {
    state.showSelectedOnly = false;
    if (elements.showSelectedOnly) {
      elements.showSelectedOnly.checked = false;
    }
  }
}

function applySelectionChange(id, checked, origin) {
  if (!id) return;

  if (checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  syncMirroredCheckboxes(id, checked, origin);
  renderSelectedCustomersBox();

  if (!state.selectedIds.size && state.showSelectedOnly) {
    state.showSelectedOnly = false;
    if (elements.showSelectedOnly) {
      elements.showSelectedOnly.checked = false;
    }
    render();
    return;
  }

  if (state.showSelectedOnly && !checked) {
    render();
    return;
  }

  syncSelectAllState();
}



function updateLocalQuote(id, updates) {

  const apply = (list) => {

    const item = list.find((quote) => quote.id === id);

    if (item) Object.assign(item, updates);

  };

  apply(state.quotes);

  apply(state.filtered);

  state.selectedForEmail = state.selectedForEmail.map((quote) =>

    quote.id === id ? { ...quote, ...updates } : quote,

  );

}



async function loadQuotes() {

  if (!elements.quotesBody) return;

  elements.quotesBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
  console.log("[Admin] loadQuotes running");
  try {
    console.time('[Admin] loadQuotes Firestore');
    const q = collection(db, "quotes");
    const snapshot = await getDocs(q);
    console.log('[Admin] Firestore docs:', snapshot.size ?? snapshot.docs.length);
    const quotes = snapshot.docs
      .map((docSnap) => normaliseQuote(docSnap))
      .filter((quote) => !quote.deleted);
    console.timeEnd('[Admin] loadQuotes Firestore');
    state.quotes = sortQuotes(quotes);
    state.filtered = [...state.quotes];
    state.currentPage = 1;
    pruneSelectedIds();
    const map = new Map(state.quotes.map((quote) => [quote.id, quote]));
    state.selectedForEmail = state.selectedForEmail
      .map((quote) => map.get(quote.id))
      .filter(Boolean);
    state.selectedForSchedule = state.selectedForSchedule
      .map((quote) => map.get(quote.id))
      .filter(Boolean);
    // Auto-revert expired Gold-for-Silver offers for unbooked quotes
  await autoRevertExpiredOffers(state.quotes);

  render();

    renderSelectedRecipients();

    updatePreview(state.previewView);

  } catch (error) {

    console.error('loadQuotes failed', error);

    elements.quotesBody.innerHTML =

      '<tr><td colspan="8">Failed to load quotes (check console)</td></tr>';

  }

}

function shouldRevertOffer(quote) {
  try {
    const applied = quote.offerApplied === true;
    const type = String(quote.offerType || "").toLowerCase();
    const tier = String(quote.tier || "").toLowerCase();
    const category = resolveStatusCategory(quote);
    const expiresAt = quote.offerExpiresAt ? new Date(quote.offerExpiresAt) : null;
    const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;
    return applied && type === "gold-for-silver" && tier === "gold" && expired && category !== "BOOKED";
  } catch (_) {
    return false;
  }
}

async function autoRevertExpiredOffers(quotes) {
  const toUpdate = quotes.filter(shouldRevertOffer);
  if (!toUpdate.length) return;
  for (const quote of toUpdate) {
    try {
      // Derive per-clean silver price from stored values
      let silverPerClean = Number(quote.pricePerClean);
      if (!Number.isFinite(silverPerClean) || silverPerClean <= 0) {
        const total = Number(quote.price);
        if (Number.isFinite(total) && total > 0) {
          silverPerClean = total / 3;
        } else {
          const resolved = Number(resolvePricePerClean(quote));
          silverPerClean = Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
        }
      }
      if (!Number.isFinite(silverPerClean) || silverPerClean <= 0) continue;

      // Revert to Gold multiplier (Gold 1.35x of Silver)
      const goldPerClean = Math.max(16, silverPerClean * 1.35);
      const pricePerClean = round2(goldPerClean);
      const price = round2(pricePerClean * 3);

      const updates = {
        pricePerClean,
        price,
        offerApplied: false,
        offerType: null,
        offerExpiresAt: null,
      };

      await updateDoc(doc(db, "quotes", quote.id), updates);
      Object.assign(quote, updates);
      updateLocalQuote(quote.id, updates);
    } catch (error) {
      console.warn("Auto-revert offer failed for", quote.id, error);
    }
  }
  // Notify other tabs to refresh if any were changed
  notifyQuotesUpdated();
}

if (syncChannel) {
  syncChannel.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "quotes-updated" && data.source !== SYNC_SOURCE) {
      if (syncReloadInProgress) return;
      syncReloadInProgress = true;
      loadQuotes()
        .catch((error) => console.error("Sync reload failed", error))
        .finally(() => {
          syncReloadInProgress = false;
        });
    }
  });
}


function buildDetailsRow(quote, columnCount) {

  const details = document.createElement("tr");

  details.className = "details-row";

  details.dataset.detailFor = quote.id;



  const cell = document.createElement("td");

  cell.colSpan = columnCount;

  const repCodeValue = escapeHtml(String(quote.repCode || "").toUpperCase());
  const houseSizeRaw = quote.houseSize || "";
  const houseTypeValue = escapeHtml(quote.houseType || "");
  const extension = toBoolean(quote.extension);
  const conservatory = toBoolean(quote.conservatory);
  const alternating = toBoolean(quote.alternating);
  const skylightsValue = escapeHtml(String(Math.max(0, Number(quote.skylights ?? 0))));
  const roofLanternsValue = escapeHtml(String(Math.max(0, Number(quote.roofLanterns ?? 0))));
  const partialValue = escapeHtml(
    String(Math.max(0, Math.min(100, Number(quote.partialCleaning ?? 100) || 0))),
  );
  const notesValue = escapeHtml(quote.notes || "");
  const customerNameValue = escapeHtml(quote.customerName || "");
  const addressValue = escapeHtml(quote.address || "");
  const mobileValue = escapeHtml(quote.mobile || quote.phone || "");
  const emailValue = escapeHtml(quote.email || "");
  const refValue = escapeHtml(quote.refCode || "");
  const tierValue = escapeHtml(quote.tier || "");
  const pricePerCleanNumber = resolvePricePerClean(quote);
  const pricePerCleanValue =
    pricePerCleanNumber !== 0
      ? escapeHtml(Number(pricePerCleanNumber).toFixed(2))
      : "";
  const priceValue =
    quote.price !== undefined && quote.price !== null
      ? escapeHtml(Number(quote.price).toFixed(2))
      : "";

  const standardSizes = ["2 bed", "3 bed", "4 bed", "5 bed", "6 bed", "Other"];

  const houseSizeOptionsHtml = standardSizes
    .map((value) => {
      const selectedAttr =
        houseSizeRaw && value.toLowerCase() === houseSizeRaw.toLowerCase() ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selectedAttr}>${escapeHtml(value)}</option>`;
    })
    .join("");

  const customSizeOption =
    houseSizeRaw &&
    !standardSizes.some((value) => value.toLowerCase() === houseSizeRaw.toLowerCase())
      ? `<option value="${escapeHtml(houseSizeRaw)}" selected>${escapeHtml(houseSizeRaw)}</option>`
      : "";

  cell.innerHTML = `
    <div class="details-panel">
      <div class="details-panel__header" role="button" tabindex="0" aria-label="Hide more info">
        <span>More info</span>
      </div>
      <form class="details-form" data-id="${quote.id}">
        <div class="details-grid">
          <label class="details-field">
            <span>Name</span>
            <input type="text" name="customerName" value="${customerNameValue}" />
          </label>
          <label class="details-field">
            <span>Rep code</span>
            <input type="text" name="repCode" value="${repCodeValue}" />
          </label>
          <label class="details-field">
            <span>Address</span>
            <textarea name="address" rows="2">${addressValue}</textarea>
          </label>
          <label class="details-field">
            <span>Mobile</span>
            <input type="tel" name="mobile" value="${mobileValue}" />
          </label>
          <label class="details-field">
            <span>Email</span>
            <input type="email" name="email" value="${emailValue}" />
          </label>
          <label class="details-field">
            <span>Customer ref</span>
            <input type="text" name="refCode" value="${refValue}" />
          </label>
          <label class="details-notes">
            <span>Notes</span>
            <textarea name="notes" rows="3" placeholder="Add notes for this customer">${notesValue}</textarea>
          </label>
          <label class="details-field">
            <span>House type</span>
            <input type="text" name="houseType" value="${houseTypeValue}" />
          </label>
          <label class="details-field">
            <span>House size</span>
            <select name="houseSize">
              <option value="">Select size</option>
              ${houseSizeOptionsHtml}
              ${customSizeOption}
            </select>
          </label>
          <label class="details-field">
            <span>Service tier</span>
            <input type="text" name="tier" value="${tierValue}" />
          </label>
          <label class="details-field">
            <span>Conservatory</span>
            <select name="conservatory">
              <option value="false"${conservatory ? "" : " selected"}>No</option>
              <option value="true"${conservatory ? " selected" : ""}>Yes</option>
            </select>
          </label>
          <label class="details-field">
            <span>Extension</span>
            <select name="extension">
              <option value="false"${extension ? "" : " selected"}>No</option>
              <option value="true"${extension ? " selected" : ""}>Yes</option>
            </select>
          </label>
          <label class="details-field">
            <span>Roof lanterns</span>
            <input type="number" name="roofLanterns" min="0" step="1" value="${roofLanternsValue}" />
          </label>
          <label class="details-field">
            <span>Skylights</span>
            <input type="number" name="skylights" min="0" step="1" value="${skylightsValue}" />
          </label>
          <label class="details-field">
            <span>Partial cleaning %</span>
            <input type="number" name="partialCleaning" min="0" max="100" step="1" value="${partialValue}" />
          </label>
          <label class="details-field">
            <span>Alternating service</span>
            <select name="alternating">
              <option value="false"${alternating ? "" : " selected"}>No</option>
              <option value="true"${alternating ? " selected" : ""}>Yes</option>
            </select>
          </label>
          <label class="details-field">
            <span>Price per clean (GBP)</span>
            <input type="number" name="pricePerClean" min="0" step="0.01" value="${pricePerCleanValue}" />
          </label>
          <label class="details-field">
            <span>Upfront price (GBP)</span>
            <input type="number" name="price" min="0" step="0.01" value="${priceValue}" />
          </label>
        </div>
        <div class="details-actions">
          <span class="details-status" aria-live="polite"></span>
          <button type="button" class="btn btn-secondary" data-id="${quote.id}" onclick="openCustomerLocationModal('${quote.id}')">📍 Set Location</button>
          <button type="submit" class="btn btn-primary details-save" data-id="${quote.id}">Save changes</button>
        </div>
      </form>
    </div>
  `;

  details.appendChild(cell);

  return details;

}

function setupDetailForm(detailsEl, quote, parentRow) {

  const form = detailsEl.querySelector(".details-form");

  if (!form) return;

  const statusEl = form.querySelector(".details-status");
  const saveButton = form.querySelector(".details-save");
  const headerToggle = detailsEl.querySelector(".details-panel__header");
  const detailsPanel = detailsEl.querySelector(".details-panel");

  if (headerToggle && parentRow) {
    headerToggle.setAttribute("aria-expanded", "true");
    const handleToggle = (event) => {
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      toggleDetailRow(parentRow, quote);
      parentRow.focus();
    };
    headerToggle.addEventListener("click", handleToggle);
    headerToggle.addEventListener("keydown", handleToggle);
  }

  if (detailsPanel && parentRow) {
    detailsPanel.addEventListener("click", (event) => {
      if (event.target.closest(".details-form") || event.target.closest(".details-panel__header")) {
        return;
      }
      toggleDetailRow(parentRow, quote);
      parentRow.focus();
    });
  }

  const setStatus = (message, type) => {

    if (!statusEl) return;

    statusEl.textContent = message;

    statusEl.classList.remove("success", "error");

    if (type) {

      statusEl.classList.add(type);

    }

  };

  const houseSizeSelect = form.elements.houseSize;

  if (houseSizeSelect) {

    const value = quote.houseSize || "";

    if (value && !Array.from(houseSizeSelect.options).some((option) => option.value.toLowerCase() === value.toLowerCase())) {

      const option = document.createElement("option");

      option.value = value;

      option.textContent = value;

      option.selected = true;

      houseSizeSelect.appendChild(option);

    }

  }

  form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const formData = new FormData(form);
    const toBool = (name) => formData.get(name) === "true";
    const priceInput = formData.get("price");
    const parsedPrice =
      priceInput === null || priceInput === ""
        ? quote.price ?? 0
        : Number(priceInput);
    const normalisedPrice = Number.isFinite(parsedPrice) ? parsedPrice : quote.price ?? 0;
    const pricePerCleanInput = formData.get("pricePerClean");
    const parsedPerClean =
      pricePerCleanInput === null || pricePerCleanInput === ""
        ? resolvePricePerClean(quote)
        : Number(pricePerCleanInput);
    const normalisedPerClean = Number.isFinite(parsedPerClean)
      ? parsedPerClean
      : resolvePricePerClean(quote);

    const updates = {

      houseSize: (formData.get("houseSize") || "").trim(),

      houseType: (formData.get("houseType") || "").trim(),

      extension: toBool("extension"),

      conservatory: toBool("conservatory"),

      skylights: Math.max(0, Math.min(10, Number(formData.get("skylights")) || 0)),

      roofLanterns: Math.max(0, Math.min(10, Number(formData.get("roofLanterns")) || 0)),

      partialCleaning: Math.max(0, Math.min(100, Number(formData.get("partialCleaning")) || 0)),

      alternating: toBool("alternating"),

      notes: (formData.get("notes") || "").toString().trim(),

      customerName: (formData.get("customerName") || "").toString().trim(),

      address: (formData.get("address") || "").toString().trim(),

      mobile: (formData.get("mobile") || "").toString().trim(),

      email: (formData.get("email") || "").toString().trim(),

      refCode: (formData.get("refCode") || "").toString().trim(),

      tier: (formData.get("tier") || "").toString().trim(),

      price: normalisedPrice,
      pricePerClean: normalisedPerClean,
      price_per_clean: normalisedPerClean,

    };

    const repCodeRaw = formData.get("repCode");

    if (repCodeRaw !== null) {

      updates.repCode = repCodeRaw.toString().trim().toUpperCase();

    }

    setStatus("Saving...");

    saveButton?.setAttribute("disabled", "disabled");

    try {

      await updateDoc(doc(db, "quotes", quote.id), updates);

      Object.assign(quote, updates);

      updateLocalQuote(quote.id, updates);

      renderSelectedRecipients();

      updatePreview(state.previewView);

      notifyQuotesUpdated();

      setStatus("Saved", "success");

      setTimeout(() => setStatus("", ""), 3000);

    } catch (error) {

      console.error("Failed to update quote", quote.id, error);

      setStatus("Save failed", "error");

    } finally {

      saveButton?.removeAttribute("disabled");

    }

  });
}



function createEmailPreviewHtml(quote, firstClean, secondDate, thirdDate) {
  if (!quote) {
    return '<p class="text-muted">Select at least one quote to preview the email.</p>';
  }

  const formatDate = (date) =>
    date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const firstDate = formatDate(firstClean);
  const secondDateStr = formatDate(secondDate);
  const thirdDateStr = formatDate(thirdDate);
  const safe = (value) => escapeHtml(value || "");
  const logoUrl =
    "https://static.wixstatic.com/media/8d161e_3f05bebd4d0a48b785070adc8ec12a0c~mv2.png";

  return `
    <table class="booking-email" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f4f6f8">
      <tr>
        <td align="center" style="padding:24px;">
          <table class="booking-email__container" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td class="booking-email__header" style="background:#0078d7;text-align:center;padding:20px;">
                <img src="${logoUrl}" alt="Swash Cleaning Ltd" style="width:160px;height:auto;">
              </td>
            </tr>
            <tr>
              <td class="booking-email__content" style="padding:30px 40px;color:#333;font-family:'Segoe UI', Arial, sans-serif;">
                <h2 style="color:#0078d7;margin:0 0 16px;font-size:22px;">Your first clean is booked for ${safe(firstDate)}</h2>
                <p style="line-height:1.6;font-size:16px;margin:0 0 14px;">Hi <strong>${safe(quote.customerName)}</strong>,</p>
                <p style="line-height:1.6;font-size:16px;margin:0 0 14px;">
                  Thank you for your payment for your first <strong>3 cleans</strong> with us &ndash; it's been recorded successfully.
                  You can always use your <strong>Ref Code:</strong>
                  <span style="color:#0078d7;font-weight:bold;">${safe(quote.refCode)}</span> when paying for future cleaning blocks (3 cleans at a time).
                </p>
                <p style="line-height:1.6;font-size:16px;margin:0 0 14px;">
                  We've scheduled your <strong>first clean</strong> for <strong>${safe(firstDate)}</strong>.<br />
                  Your <strong>second clean</strong> should fall close to <strong>${safe(secondDateStr)}</strong>, and your <strong>third clean</strong> near <strong>${safe(thirdDateStr)}</strong>.
                  (Please note: these may vary slightly due to weather.)
                </p>
                <p style="line-height:1.6;font-size:16px;margin:0 0 14px;">
                  You'll receive a reminder email the day before your clean. We look forward to being of service and keeping your windows sparkling!
                </p>
                <p style="line-height:1.6;font-size:16px;margin:0 0 14px;">
                  Please don't forget &ndash; your feedback means the world to us.
                  If you're happy, a quick
                  <a href="https://g.page/r/CfpJ6CXobYIuEBM/review" target="_blank" style="color:#0078d7;">Google review</a> really helps us grow.
                  If there's ever an issue, just reply to this email so we can make it right straight away.
                </p>
                <p style="line-height:1.6;font-size:16px;margin:30px 0 0;">
                  Best regards,<br />
                  <strong>Christopher Wessell</strong><br />
                  <em>Director &ndash; Swash Cleaning Ltd</em><br />
                  <a href="tel:03300436345" style="color:#0078d7;">03300 436 345</a><br />
                  <a href="https://www.swashcleaning.co.uk" target="_blank" style="color:#0078d7;">www.swashcleaning.co.uk</a>
                </p>
              </td>
            </tr>
            <tr>
              <td class="booking-email__footer" style="background:#f0f4f8;text-align:center;padding:14px;font-size:13px;color:#666;font-family:'Segoe UI', Arial, sans-serif;">
                &copy; ${new Date().getFullYear()} Swash Cleaning Ltd. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}



function buildEmailPreview(view = state.previewView || "desktop") {

  if (!state.selectedForEmail.length) {

    return '<p class="text-muted">Select at least one quote to preview the email.</p>';

  }

  const baseDate = getFirstCleanDate() || new Date();

  const secondDate = addDays(baseDate, 28);

  const thirdDate = addDays(baseDate, 56);

  return createEmailPreviewHtml(state.selectedForEmail[0], baseDate, secondDate, thirdDate);

}

function updatePreview(view = state.previewView || "desktop") {

  state.previewView = view;

  if (!elements.emailPreview) return;

  const html = buildEmailPreview(view);

  const hasSelection = state.selectedForEmail.length > 0;

  elements.emailPreview.innerHTML = html;

  elements.emailPreview.classList.toggle("mobile-view", view === "mobile" && hasSelection);

  elements.tabButtons.forEach((button) => {

    button.classList.toggle("active", button.dataset.tab === view);

  });

}

function getFirstCleanDate() {

  const input = elements.cleanDate || document.getElementById("cleanDate");

  if (!input) return null;

  elements.cleanDate = input;

  const value = (input.value || "").trim();

  if (!value) return null;

  const parsed = new Date(`${value}T00:00:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;

}







async function sendBookingEmails() {

  const selected = state.selectedForEmail.length ? state.selectedForEmail : getSelectedQuotes();

  if (!selected.length) {

    alert("Select at least one quote to send booking confirmations.");

    return;

  }

  const firstClean = getFirstCleanDate();

  if (!firstClean) {

    alert("Choose a first clean date before sending emails.");

    elements.cleanDate?.focus();

    return;

  }

  const cleanerSelection = elements.emailCleaner?.value || "";
  state.emailCleaner = cleanerSelection;
  const cleanerUpdate = resolveCleanerUpdate(cleanerSelection);

  const schedulePlan = buildSchedulePlan(firstClean);
  const firstCleanStr = schedulePlan.firstLabel;
  const secondCleanStr = formatScheduleDate(schedulePlan.secondDate);
  const thirdCleanStr = formatScheduleDate(schedulePlan.thirdDate);
  const total = selected.length;
  let sentCount = 0;
  setSendProgress(0, total);
  const results = [];

  for (const quote of selected) {
    try {
      const recipientEmail = resolveQuoteEmail(quote);
      if (!recipientEmail) {
        throw new Error("Recipient email missing");
      }
      const templateParams = {
        customer_name: quote.customerName || "",
        ref_code: quote.refCode || "",
        date: firstCleanStr,
        second_date: secondCleanStr,
        third_date: thirdCleanStr,
        email: recipientEmail,
      };
      console.log("EmailJS payload", { id: quote.id, to: recipientEmail, params: templateParams });
      if (window.emailjs && emailjs.send) {
        await emailjs.send(EMAIL_SERVICE, EMAIL_TEMPLATE, templateParams);
      }

      const bookingEmailBody = `Clean scheduled at ${quote.address || "Unknown address"} on ${firstCleanStr}. Second: ${secondCleanStr}. Third: ${thirdCleanStr}.`;
      const sentByMeta = (function(){
        const u = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : null;
        return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "admin" };
      })();
      const payload = {
        status: `Booked - ${firstCleanStr}`,
        bookedDate: firstClean.toISOString(),
        nextCleanDates: schedulePlan.nextCleanDates,
        emailLog: arrayUnion({
          type: "booking",
          subject: `Booking confirmation for ${quote.customerName}`,
          sentAt: Date.now(),
          sentTo: recipientEmail,
          success: true,
          body: bookingEmailBody,
          sentBy: sentByMeta,
        })
      };
      if (cleanerUpdate.shouldUpdate) {
        payload.assignedCleaner = cleanerUpdate.value;
      }
      await updateDoc(doc(db, "quotes", quote.id), payload);
      Object.assign(quote, payload);
      updateLocalQuote(quote.id, payload);

      sentCount += 1;
      setSendProgress(sentCount, total);

      results.push({ id: quote.id, success: true });

    } catch (error) {

      console.error("Failed to send booking email", quote.id, error);
      
      // Log failed email
      try {
        await updateDoc(doc(db, "quotes", quote.id), {
          emailLog: arrayUnion({
            type: "booking",
            subject: `Booking confirmation for ${quote.customerName}`,
            sentAt: Date.now(),
            sentTo: quote.email || quote.customerEmail || "",
            success: false,
            error: error?.message || "Send failed",
            sentBy: (function(){
              const u = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : null;
              return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "admin" };
            })(),
          })
        });
      } catch (logError) {
        console.warn("Failed to log email failure", logError);
      }

      const failBody = `Failed booking for ${quote.customerName || "Unknown"} intended for ${firstCleanStr}`;
      try {
        await updateDoc(doc(db, "quotes", quote.id), {
          emailLog: arrayUnion({
            type: "booking",
            subject: `Booking confirmation for ${quote.customerName}`,
            sentAt: Date.now(),
            sentTo: quote.email || quote.customerEmail || "",
            success: false,
            error: error?.message || "Send failed",
            body: failBody,
            sentBy: (function(){
              const u = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : null;
              return { uid: u?.uid || null, email: u?.email || null, repCode: null, source: "admin" };
            })(),
          })
        });
      } catch (logError) {
        console.warn("Failed to log booking failure body", logError);
      }
      results.push({ id: quote.id, success: false });

    }

  }

  const failures = results.filter((result) => !result.success).length;

  const successes = results.length - failures;

  if (failures) {
    await delay(3000);
    alert(`${successes} sent, ${failures} failed. Check console for details.`);
  } else {
    await delay(3000);
    alert(`Sent ${successes} booking confirmation(s).`);
  }

  closeModal();

  await loadQuotes();

  await loadQuotes();

  if (successes) {
    notifyQuotesUpdated();
  }
}

async function archiveSelected() {

  const ids = getSelectedIds();

  if (!ids.length) {

    alert("Select at least one quote to archive.");

    return;

  }

  const selectedQuotes = state.quotes.filter((quote) => ids.includes(quote.id));
  const labels = selectedQuotes
    .map((quote) => quote.customerName || quote.address || quote.refCode || quote.email)
    .filter(Boolean);
  const displayNames = labels.slice(0, 3).map((label) => `• ${label}`);
  const remaining = labels.length - displayNames.length;
  const detailBlock =
    displayNames.length || remaining > 0
      ? `\n\n${displayNames.join("\n")}${remaining > 0 ? `\n• +${remaining} more` : ""}`
      : "";

  const confirmed = confirm(

    `Archive ${ids.length} quote(s)? They will be hidden from the dashboard.${detailBlock}`,

  );

  if (!confirmed) return;



  let changed = false;

  for (const id of ids) {

    try {

      await updateDoc(doc(db, "quotes", id), {

        deleted: true,

        status: "Archived",

      });

      changed = true;

    } catch (error) {

      console.error("Failed to archive quote", id, error);

    }

  }



  await loadQuotes();

  if (changed) {
    notifyQuotesUpdated();
  }

}



function exportCsv() {

  const rows = [

    [

      "Ref Code",

      "Quote Date",

      "Customer",

      "Address",

      "Mobile",

      "Email",

      "Tier",

      "Price Per Clean",

      "Upfront Price",

      "Status",

    ],

  ];



  state.filtered.forEach((quote) => {

    rows.push([

      quote.refCode || "",

      formatDate(quote.date),

      quote.customerName || "",

      quote.address || "",

      quote.mobile || "",

      quote.email || "",

      quote.tier || "",

      formatCurrency(resolvePricePerClean(quote)),

      formatCurrency(quote.price),

      quote.status || "",

    ]);

  });



  const csvContent = rows

    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))

    .join("\n");



  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);

  link.download = "swash-quotes.csv";

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

}



function handleTableClick(event) {

  if (event.target.closest('input[type="checkbox"]')) {

    return;

  }

  const row = event.target.closest("tr[data-id]");

  if (!row) return;

  const quote = state.filtered.find((item) => item.id === row.dataset.id);

  if (!quote) return;

  toggleDetailRow(row, quote);

}



function handleTableKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest('input[type="checkbox"]')) return;
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  event.preventDefault();
  const quote = state.filtered.find((item) => item.id === row.dataset.id);
  if (!quote) return;
  toggleDetailRow(row, quote);
}

function prepareSendEmailAction() {
  const selected = getSelectedQuotes();
  if (!selected.length) {
    alert("Select at least one quote first.");
    return;
  }
  state.selectedForEmail = selected;
  populateCleanerSelect(elements.emailCleaner, {
    includePlaceholder: true,
    placeholderLabel: "Keep current",
    includeUnassigned: true,
  });
  if (elements.emailCleaner) {
    let prefill = state.emailCleaner || deriveCleanerPrefill(selected);
    if (prefill && !elements.emailCleaner.querySelector(`option[value="${prefill}"]`)) {
      prefill = "";
    }
    elements.emailCleaner.value = prefill || "";
    state.emailCleaner = elements.emailCleaner.value || "";
  }
  if (elements.cleanDate && !elements.cleanDate.value) {
    elements.cleanDate.value = new Date().toISOString().slice(0, 10);
  }
  renderSelectedRecipients();
  setSendProgress(0, selected.length);
  state.previewView = state.previewView || "desktop";
  updatePreview(state.previewView);
  openModal();
}

function toggleActionsMenu(forceState) {
  state.actionsMenuOpen = typeof forceState === "boolean" ? forceState : !state.actionsMenuOpen;
  const expanded = state.actionsMenuOpen;
  if (elements.actionsToggle) {
    elements.actionsToggle.setAttribute("aria-expanded", String(expanded));
  }
  if (elements.actionsMenu) {
    elements.actionsMenu.style.display = expanded ? "block" : "none";
    elements.actionsMenu.setAttribute("aria-hidden", String(!expanded));
  }
}

function closeActionsMenu() {
  toggleActionsMenu(false);
}

function handleActionsDocumentClick(event) {
  if (!state.actionsMenuOpen) return;
  if (elements.actionsDropdown && elements.actionsDropdown.contains(event.target)) return;
  closeActionsMenu();
}

function handleActionsKeydown(event) {
  if (event.key === "Escape" && state.actionsMenuOpen) {
    closeActionsMenu();
  }
}

function runAction(action) {
  switch (action) {
    case "sendEmails":
      prepareSendEmailAction();
      break;
    case "schedule":
      openScheduleModal();
      break;
    case "archive":
      archiveSelected();
      break;
    case "export":
      exportCsv();
      break;
    case "import":
      openImportModal();
      break;
    default:
      break;
  }
  closeActionsMenu();
}

async function handleAssignCleaner() {
  if (!elements.assignCleanerSelect) return;
  const cleanerSelection = elements.assignCleanerSelect.value || "";
  state.assignCleaner = cleanerSelection;
  const assignment = resolveCleanerUpdate(cleanerSelection);
  if (!assignment.shouldUpdate) {
    alert("Choose a cleaner (or Unassigned) before applying.");
    elements.assignCleanerSelect.focus();
    return;
  }
  const selectedQuotes = getSelectedQuotes();
  if (!selectedQuotes.length) {
    alert("Select at least one quote to assign first.");
    return;
  }

  const button = elements.assignCleanerApply;
  const select = elements.assignCleanerSelect;
  button?.setAttribute("disabled", "disabled");
  select?.setAttribute("disabled", "disabled");

  try {
    let updatedCount = 0;
    for (const quote of selectedQuotes) {
      const updates = { assignedCleaner: assignment.value };
      await updateDoc(doc(db, "quotes", quote.id), updates);
      quote.assignedCleaner = assignment.value;
      updateLocalQuote(quote.id, updates);
      updatedCount += 1;
    }
    render();
    renderSelectedRecipients();
    updatePreview(state.previewView);
    notifyQuotesUpdated();
    const label =
      assignment.value === null ? "Unassigned" : assignment.value || "Unassigned";
    alert(`Assigned ${updatedCount} customer${updatedCount === 1 ? "" : "s"} to ${label}.`);
  } catch (error) {
    console.error("Failed to assign cleaner", error);
    alert("Assignment failed. Please try again.");
  } finally {
    button?.removeAttribute("disabled");
    select?.removeAttribute("disabled");
  }
}

function attachEvents(){
  populateCleanerSelect(elements.assignCleanerSelect, {
    includePlaceholder: true,
    placeholderLabel: "Select cleaner",
    includeUnassigned: true,
  });
  populateCleanerSelect(elements.scheduleCleaner, {
    includePlaceholder: true,
    placeholderLabel: "Keep current",
    includeUnassigned: true,
  });
  populateCleanerSelect(elements.emailCleaner, {
    includePlaceholder: true,
    placeholderLabel: "Keep current",
    includeUnassigned: true,
  });
  elements.assignCleanerSelect?.addEventListener("change", (event) => {
    state.assignCleaner = event.target.value || "";
  });
  elements.assignCleanerApply?.addEventListener("click", handleAssignCleaner);
  elements.scheduleCleaner?.addEventListener("change", (event) => {
    state.scheduleCleaner = event.target.value || "";
  });
  elements.emailCleaner?.addEventListener("change", (event) => {
    state.emailCleaner = event.target.value || "";
  });
  elements.applyFilters?.addEventListener("click", filterQuotes);
  elements.repFilter?.addEventListener("change", filterQuotes);
  elements.clearFilters?.addEventListener("click", () => {
    if (elements.startDate) elements.startDate.value = "";
    if (elements.endDate) elements.endDate.value = "";
    if (elements.repFilter) elements.repFilter.value = "ALL";
    if (elements.statusFilter) elements.statusFilter.value = "ALL";
    if (elements.showSelectedOnly) elements.showSelectedOnly.checked = false;
    state.showSelectedOnly = false;
    state.filtered = state.quotes;
    state.currentPage = 1;
    render();
  });

  elements.statusFilter?.addEventListener("change", filterQuotes);
  elements.showSelectedOnly?.addEventListener("change", (event) => {
    if (event.target.checked && !state.selectedIds.size) {
      event.target.checked = false;
      state.showSelectedOnly = false;
      alert("Select at least one quote before using Show selected only.");
      return;
    }
    state.showSelectedOnly = event.target.checked;
    state.currentPage = 1;
    render();
  });
  elements.searchInput?.addEventListener("input", (event) => {
    state.searchQuery = event.target.value || "";
    state.currentPage = 1;
    render();
  });

  elements.prevPageBtn?.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      render();
    }
  });

  elements.nextPageBtn?.addEventListener("click", () => {
    const { totalPages } = getPaginationSnapshot();
    if (state.currentPage < totalPages) {
      state.currentPage += 1;
      render();
    }
  });

  elements.selectAll?.addEventListener("change", (event) => {
    const checked = event.target.checked;
    state.visibleIds.forEach((id) => {
      if (checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
    });
    if (!state.selectedIds.size && state.showSelectedOnly) {
      state.showSelectedOnly = false;
      if (elements.showSelectedOnly) {
        elements.showSelectedOnly.checked = false;
      }
      render();
      return;
    }
    if (state.showSelectedOnly && !checked) {
      render();
      return;
    }
    syncSelectionCheckboxes();
    syncSelectAllState();
    renderSelectedCustomersBox();
  });

  elements.quotesBody?.addEventListener("click", handleTableClick);

  elements.quotesBody?.addEventListener("keydown", handleTableKeydown);
  elements.quotesBody?.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-id]');
    if (!checkbox) return;
    applySelectionChange(checkbox.dataset.id, checkbox.checked, checkbox);
  });

  elements.quotesCards?.addEventListener("click", (event) => {
    const card = event.target.closest(".quote-card");
    if (!card) return;
    if (event.target.tagName === "BUTTON" || event.target.closest("button")) return;
    if (event.target.tagName === "A" || event.target.closest("a")) return;
    const checkbox = card.querySelector('input[type="checkbox"][data-id]');
    if (checkbox && event.target !== checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  elements.quotesCards?.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-id]');
    if (!checkbox) return;
    applySelectionChange(checkbox.dataset.id, checkbox.checked, checkbox);
  });

  elements.actionsDropdown = elements.actionsDropdown || document.querySelector(".actions-dropdown");
  elements.actionsMenu = elements.actionsMenu || document.getElementById("actionsMenu");
  elements.actionsToggle = elements.actionsToggle || document.getElementById("actionsToggle");
  elements.actionButtons = Array.from(document.querySelectorAll("#actionsMenu [data-action]"));

  elements.actionsToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleActionsMenu();
  });

  elements.actionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      runAction(button.dataset.action);
    });
  });

  document.addEventListener("click", handleActionsDocumentClick);
  document.addEventListener("keydown", handleActionsKeydown);
  closeActionsMenu();

  elements.confirmSend?.addEventListener("click", sendBookingEmails);
  elements.scheduleCancel?.addEventListener("click", closeScheduleModal);
  elements.scheduleConfirm?.addEventListener("click", handleScheduleConfirm);
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      updatePreview(button.dataset.tab);
    });
  });
  if (elements.showSelectedOnly) {
    elements.showSelectedOnly.checked = state.showSelectedOnly;
  }

  elements.cleanDate?.addEventListener("change", () => updatePreview());
  document.getElementById("refreshPreview")?.addEventListener("click", () => updatePreview());
  document.getElementById("closeModal")?.addEventListener("click", closeModal);
  document.getElementById("closeModalSecondary")?.addEventListener("click", closeModal);
}

// ===== CUSTOMER LOCATION MODAL =====
let customerLocationMap = null;
let customerLocationMarker = null;
let currentEditingQuoteId = null;

function initCustomerLocationModal() {
  const closeBtn = document.getElementById("closeCustomerLocationModal");
  const cancelBtn = document.getElementById("cancelCustomerLocationBtn");
  const saveBtn = document.getElementById("saveCustomerLocationBtn");
  const modal = document.getElementById("setCustomerLocationModal");

  if (!closeBtn) return; // Modal not on page

  closeBtn.addEventListener("click", () => {
    modal.hidden = true;
    customerLocationMap = null;
    customerLocationMarker = null;
  });

  cancelBtn.addEventListener("click", () => {
    modal.hidden = true;
    customerLocationMap = null;
    customerLocationMarker = null;
  });

  saveBtn.addEventListener("click", async () => {
    const lat = parseFloat(document.getElementById("customerLocationLatInput")?.value);
    const lng = parseFloat(document.getElementById("customerLocationLngInput")?.value);

    if (isNaN(lat) || isNaN(lng)) {
      alert("Please set a valid location on the map");
      return;
    }

    if (!currentEditingQuoteId) {
      alert("Error: No quote selected");
      return;
    }

    try {
      const quoteRef = doc(db, "quotes", currentEditingQuoteId);
      await updateDoc(quoteRef, {
        customerLatitude: lat,
        customerLongitude: lng,
      });

      // Update local state
      const quote = state.quotes.find(q => q.id === currentEditingQuoteId);
      if (quote) {
        quote.customerLatitude = lat;
        quote.customerLongitude = lng;
      }

      modal.hidden = true;
      customerLocationMap = null;
      customerLocationMarker = null;
      currentEditingQuoteId = null;
      alert("✓ Customer location saved!");
      render();
    } catch (err) {
      console.error("Error saving customer location:", err);
      alert("Failed to save location. Please try again.");
    }
  });
}

function openCustomerLocationModal(quoteId) {
  const quote = state.quotes.find(q => q.id === quoteId);
  if (!quote) {
    alert("Quote not found");
    return;
  }

  currentEditingQuoteId = quoteId;
  const modal = document.getElementById("setCustomerLocationModal");
  const addressDisplay = document.getElementById("customerLocationAddressDisplay");
  const latInput = document.getElementById("customerLocationLatInput");
  const lngInput = document.getElementById("customerLocationLngInput");

  addressDisplay.textContent = quote.address || "Unknown";

  // Set initial coordinates - use existing or Maldon default
  let initialLat = quote.customerLatitude || 51.7356;
  let initialLng = quote.customerLongitude || 0.6756;

  latInput.value = initialLat.toFixed(6);
  lngInput.value = initialLng.toFixed(6);

  modal.hidden = false;

  // If customer doesn't have coordinates but has an address, geocode it first
  if (!quote.customerLatitude && quote.address && window.google && google.maps.Geocoder) {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: quote.address }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK && results.length > 0) {
        const location = results[0].geometry.location;
        initialLat = location.lat();
        initialLng = location.lng();
        latInput.value = initialLat.toFixed(6);
        lngInput.value = initialLng.toFixed(6);
        
        // Update map if already created
        if (customerLocationMap && customerLocationMarker) {
          customerLocationMarker.setPosition({ lat: initialLat, lng: initialLng });
          customerLocationMap.panTo({ lat: initialLat, lng: initialLng });
          customerLocationMap.setZoom(16);
        } else {
          // Initialize map with geocoded coordinates
          initCustomerLocationMap(initialLat, initialLng);
        }
      }
    });
    
    // Still initialize map, will be updated once geocoding completes
    setTimeout(() => initCustomerLocationMap(initialLat, initialLng), 100);
  } else {
    // Use existing coordinates or default
    setTimeout(() => initCustomerLocationMap(initialLat, initialLng), 100);
  }
}

function initCustomerLocationMap(lat, lng) {
  if (customerLocationMap) {
    // Map already exists, just update it
    customerLocationMarker.setPosition({ lat, lng });
    customerLocationMap.panTo({ lat, lng });
    return;
  }

  const mapElement = document.getElementById("customerLocationMap");
  if (!mapElement) return;

  customerLocationMap = new google.maps.Map(mapElement, {
    zoom: 15,
    center: { lat, lng },
    mapTypeId: "roadmap",
  });

  customerLocationMarker = new google.maps.Marker({
    position: { lat, lng },
    map: customerLocationMap,
    draggable: true,
    title: "Customer location",
  });

  customerLocationMarker.addListener("drag", () => {
    const pos = customerLocationMarker.getPosition();
    const latInput = document.getElementById("customerLocationLatInput");
    const lngInput = document.getElementById("customerLocationLngInput");
    if (latInput) latInput.value = pos.lat().toFixed(6);
    if (lngInput) lngInput.value = pos.lng().toFixed(6);
  });

  customerLocationMap.addListener("click", (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    customerLocationMarker.setPosition({ lat, lng });
    const latInput = document.getElementById("customerLocationLatInput");
    const lngInput = document.getElementById("customerLocationLngInput");
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);
  });
}

// Expose to global scope for onclick handlers
window.openCustomerLocationModal = openCustomerLocationModal;

async function startAdminApp() {
  if (adminAppInitialised) return;
  adminAppInitialised = true;

  try {
    await waitForDomReady();
    if (window.emailjs && typeof emailjs.init === "function") {
      try {
        emailjs.init(EMAIL_PUBLIC_KEY);
      } catch (err) {
        console.warn("[Admin] emailjs.init failed", err);
      }
    }
    await loadQuotes();
    try {
      await populateAllCleanerSelects();
    } catch (error) {
      console.error("[Admin] Cleaner select population failed", error);
    }
    attachEvents();
    initCustomerLocationModal();
    renderSelectedRecipients();
    console.log("[Admin] Navigation unlocked");
  } catch (error) {
    console.error("Failed to start admin app", error);
    throw error;
  }
}

export function initAdmin() {
  if (adminBootstrapRegistered) return;
  adminBootstrapRegistered = true;

  const bootstrap = async () => {
    try {
      await authStateReady();
      console.log("[Page] Auth ready, userRole:", window.userRole);
      const routing = await handlePageRouting("admin");
      if (routing.redirected) return;
      console.log("[Admin] Auth OK");
      await waitForDomReady();
      await delay(100);
      await startAdminApp();
    } catch (error) {
      console.error("[Admin] Failed to initialise admin UI", error);
    }
  };

  bootstrap();
}

initAdmin();











































