import { auth, db } from "./public/firebase-init.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";
import { tenantCollection, tenantDoc } from "./lib/subscriber-paths.js";
import { initSubscriberHeader, setCompanyName, setActiveTab } from "./public/header-template.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDocs, orderBy, query, limit, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
  subscriberId: null,
  shifts: [],
  filtered: [],
  logsCache: new Map(),
  reps: new Set(),
};

const els = {
  overlay: document.getElementById("authOverlay"),
  page: document.getElementById("shiftsPage"),
  logoutBtn: document.getElementById("logoutBtn"),
  companyName: document.getElementById("companyNameDisplay"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  repFilter: document.getElementById("repFilter"),
  applyFilters: document.getElementById("applyFilters"),
  resetFilters: document.getElementById("resetFilters"),
  refreshData: document.getElementById("refreshData"),
  summaryTotalShifts: document.getElementById("summaryTotalShifts"),
  summaryTotalDoors: document.getElementById("summaryTotalDoors"),
  summaryTotalSignups: document.getElementById("summaryTotalSignups"),
  summaryTotalMiles: document.getElementById("summaryTotalMiles"),
  tableBody: document.getElementById("shiftTableBody"),
  modal: document.getElementById("shiftDetailModal"),
  modalTitle: document.getElementById("shiftDetailTitle"),
  modalSubtitle: document.getElementById("shiftDetailSubtitle"),
  modalBody: document.getElementById("shiftDetailBody"),
  modalClose: document.getElementById("shiftDetailClose"),
};

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const milesFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const currencyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }
  if (typeof value === "string" && value.includes("-")) {
    const parts = value.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return value;
}

function safeText(value) {
  return value || "—";
}

function updateRepFilter() {
  if (!els.repFilter) return;
  const currentValue = els.repFilter.value;
  const options = ["<option value=\"\">All reps</option>"];
  Array.from(state.reps).sort((a, b) => a.localeCompare(b)).forEach((rep) => {
    options.push(`<option value="${rep}">${rep}</option>`);
  });
  els.repFilter.innerHTML = options.join("");
  if (state.reps.has(currentValue)) {
    els.repFilter.value = currentValue;
  }
}

function updateSummary(shifts) {
  const totals = shifts.reduce((acc, shift) => {
    acc.shifts += 1;
    acc.doors += Number(shift.totals?.doors || 0);
    acc.signups += Number(shift.totals?.sales || 0);
    acc.miles += Number(shift.miles || 0);
    return acc;
  }, { shifts: 0, doors: 0, signups: 0, miles: 0 });

  if (els.summaryTotalShifts) els.summaryTotalShifts.textContent = numberFormatter.format(totals.shifts);
  if (els.summaryTotalDoors) els.summaryTotalDoors.textContent = numberFormatter.format(totals.doors);
  if (els.summaryTotalSignups) els.summaryTotalSignups.textContent = numberFormatter.format(totals.signups);
  if (els.summaryTotalMiles) els.summaryTotalMiles.textContent = milesFormatter.format(totals.miles);
}

function renderShifts() {
  if (!els.tableBody) return;

  if (!state.filtered.length) {
    els.tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No shifts match your filters.</td></tr>';
    updateSummary([]);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((shift) => {
    const row = document.createElement("tr");
    row.dataset.shiftId = shift.id;
    row.dataset.repId = shift.repId;
    row.dataset.shiftDate = shift.date;

    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(shift.date);
    row.appendChild(dateCell);

    const repCell = document.createElement("td");
    repCell.textContent = safeText(shift.repName || shift.repId);
    row.appendChild(repCell);

    const doorsCell = document.createElement("td");
    doorsCell.textContent = numberFormatter.format(shift.totals?.doors || 0);
    row.appendChild(doorsCell);

    const signupCell = document.createElement("td");
    signupCell.textContent = numberFormatter.format(shift.totals?.sales || 0);
    row.appendChild(signupCell);

    const milesCell = document.createElement("td");
    milesCell.textContent = milesFormatter.format(Number(shift.miles || 0));
    row.appendChild(milesCell);

    const payCell = document.createElement("td");
    payCell.textContent = currencyFormatter.format(Number(shift.totalOwed || shift.pay || 0));
    row.appendChild(payCell);

    fragment.appendChild(row);
  });

  els.tableBody.innerHTML = "";
  els.tableBody.appendChild(fragment);
  updateSummary(state.filtered);
}

function applyFilters() {
  const fromDate = parseDate(els.dateFrom?.value);
  const toDate = parseDate(els.dateTo?.value);
  const repValue = (els.repFilter?.value || "").trim();

  state.filtered = state.shifts.filter((shift) => {
    const shiftDate = parseDate(shift.date) || parseDate(`${shift.date}T00:00:00`);
    if (fromDate && shiftDate && shiftDate < fromDate) return false;
    if (toDate && shiftDate && shiftDate > toDate) return false;
    if (repValue && shift.repId !== repValue && shift.repName !== repValue) return false;
    return true;
  });

  renderShifts();
}

async function fetchShiftLogs(repId, date) {
  const docId = `${repId}_${date}`;
  if (state.logsCache.has(docId)) {
    return state.logsCache.get(docId);
  }
  try {
    const snapshot = await getDoc(tenantDoc(db, state.subscriberId, "repLogs", docId));
    if (snapshot.exists()) {
      const data = snapshot.data();
      const logs = Array.isArray(data.logs) ? data.logs : [];
      state.logsCache.set(docId, logs);
      return logs;
    }
  } catch (error) {
    console.error("[SubscriberShiftsLogs] Failed to fetch logs", error);
  }
  state.logsCache.set(docId, []);
  return [];
}

function renderLogs(list) {
  if (!els.modalBody) return;
  if (!list.length) {
    els.modalBody.innerHTML = '<div class="empty-state">No door activity recorded for this shift.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  list
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return aTime - bTime;
    })
    .forEach((log) => {
      const item = document.createElement("div");
      item.className = "log-entry";

      const timeEl = document.createElement("time");
      timeEl.dateTime = log.timestamp || "";
      const parsed = new Date(log.timestamp || 0);
      timeEl.textContent = Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      const detailEl = document.createElement("div");
      const status = document.createElement("strong");
      status.textContent = log.status || "Update";
      const meta = document.createElement("div");
      meta.style.fontSize = "0.85rem";
      meta.style.color = "#64748b";
      const addressParts = [log.houseNumber, log.roadName].filter(Boolean);
      if (addressParts.length) {
        meta.textContent = addressParts.join(" ");
      } else if (log.note) {
        meta.textContent = log.note;
      } else {
        meta.textContent = "";
      }
      const notes = document.createElement("div");
      notes.style.fontSize = "0.85rem";
      notes.textContent = log.addressNotes || (log.note && addressParts.length ? log.note : "");

      detailEl.appendChild(status);
      detailEl.appendChild(meta);
      if (notes.textContent) detailEl.appendChild(notes);

      item.appendChild(timeEl);
      item.appendChild(detailEl);
      fragment.appendChild(item);
    });

  els.modalBody.innerHTML = "";
  els.modalBody.appendChild(fragment);
}

async function openShiftDetail(shift) {
  if (!shift || !els.modal) return;
  els.modalTitle.textContent = `${formatDate(shift.date)} • ${safeText(shift.repName || shift.repId)}`;
  const totals = shift.totals || {};
  els.modalSubtitle.textContent = `${numberFormatter.format(totals.doors || 0)} doors • ${numberFormatter.format(totals.sales || 0)} signups`;
  els.modalBody.innerHTML = '<div class="empty-state">Loading logs…</div>';

  try {
    const logs = await fetchShiftLogs(shift.repId, shift.date);
    renderLogs(logs);
  } catch (error) {
    console.error("[SubscriberShiftsLogs] Unable to render logs", error);
    els.modalBody.innerHTML = '<div class="empty-state" style="color:#f97316;">Failed to load logs.</div>';
  }

  if (typeof els.modal.showModal === "function") {
    els.modal.showModal();
  } else {
    els.modal.setAttribute("open", "true");
  }
}

function closeModal() {
  if (!els.modal) return;
  if (typeof els.modal.close === "function") {
    els.modal.close();
  } else {
    els.modal.removeAttribute("open");
  }
}

function attachEvents() {
  if (els.applyFilters) {
    els.applyFilters.addEventListener("click", applyFilters);
  }
  if (els.resetFilters) {
    els.resetFilters.addEventListener("click", () => {
      if (els.dateFrom) els.dateFrom.value = "";
      if (els.dateTo) els.dateTo.value = "";
      if (els.repFilter) els.repFilter.value = "";
      state.filtered = state.shifts.slice();
      renderShifts();
    });
  }
  if (els.refreshData) {
    els.refreshData.addEventListener("click", async () => {
      await loadShifts();
      applyFilters();
    });
  }
  if (els.tableBody) {
    els.tableBody.addEventListener("click", (event) => {
      const row = event.target?.closest("tr");
      if (!row) return;
      const shiftId = row.dataset.shiftId;
      const shift = state.shifts.find((item) => item.id === shiftId);
      if (shift) openShiftDetail(shift);
    });
  }
  if (els.modalClose) {
    els.modalClose.addEventListener("click", closeModal);
  }
}

async function loadShifts() {
  try {
    const shiftsRef = tenantCollection(db, state.subscriberId, "repShifts");
    const snap = await getDocs(query(shiftsRef, orderBy("date", "desc"), limit(120)));
    state.reps.clear();

    state.shifts = await Promise.all(snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const repId = data.repId || docSnap.id.split("_")[0];
      state.reps.add(repId);
      return {
        id: docSnap.id,
        date: data.date || docSnap.id.split("_")[1],
        repId,
        repName: data.repName || repId,
        totals: data.totals || {},
        miles: Number(data.miles || 0),
        pay: Number(data.pay || 0),
        totalOwed: Number(data.totalOwed || data.pay || 0),
      };
    }));

    // Attempt to hydrate rep display names from user profiles if not already provided
    await Promise.all(Array.from(state.reps).map(async (repId) => {
      const cacheKey = `repName:${repId}`;
      if (!state.logsCache.has(cacheKey)) {
        try {
          const profile = await getDoc(doc(db, "users", repId));
          if (profile.exists()) {
            const data = profile.data();
            const name = data.repName || data.displayName || data.name || data.email || repId;
            state.shifts.forEach((shift) => {
              if (shift.repId === repId) {
                shift.repName = name;
              }
            });
            state.logsCache.set(cacheKey, name);
          }
        } catch (error) {
          console.warn("[SubscriberShiftsLogs] Failed to resolve rep profile", error);
        }
      } else {
        const cachedName = state.logsCache.get(cacheKey);
        state.shifts.forEach((shift) => {
          if (shift.repId === repId) shift.repName = cachedName;
        });
      }
    }));

    state.filtered = state.shifts.slice();
    updateRepFilter();
    renderShifts();
  } catch (error) {
    console.error("[SubscriberShiftsLogs] Failed to load shifts", error);
    if (els.tableBody) {
      els.tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#f97316;">Unable to load shift data.</td></tr>';
    }
  }
}

async function initialise() {
  // Initialize header first and wait for it
  await initSubscriberHeader();
  
  attachEvents();

  // Attach logout handler after header is injected
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/index.html";
      } catch (error) {
        console.error("[SubscriberShiftsLogs] Sign out failed", error);
        alert("Failed to sign out. Please try again.");
      }
    });
  }

  if (els.modal) {
    els.modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeModal();
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./subscriber-login.html";
      return;
    }

    try {
      const access = await ensureSubscriberAccess(user);
      state.subscriberId = access.subscriberId;

      if (access.viewerRole === "subscriber" && !access.subscriberProfile.billingCompleted) {
        window.location.href = "./subscriber-billing.html";
        return;
      }

      // Update header with company name and set active tab
      const profile = access.subscriberProfile;
      const companyName = profile.companyName || profile.name || "My Business";
      setCompanyName(companyName);
      setActiveTab('shifts');

      if (els.overlay) els.overlay.style.display = "none";
      if (els.page) els.page.style.display = "block";

      await loadShifts();
      applyFilters();
    } catch (error) {
      console.error("[SubscriberShiftsLogs] Access error", error);
      alert(error.message || "Unable to load shift manager");
      await signOut(auth);
      window.location.href = "./subscriber-login.html";
    }
  });
}

initialise();
