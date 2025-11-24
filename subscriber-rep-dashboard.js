import { auth, db } from "./public/firebase-init.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";
import { tenantCollection } from "./lib/subscriber-paths.js";
import { initSubscriberHeader, setCompanyName, setActiveTab } from "./public/header-template.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
  subscriberId: null,
  viewerRole: null,
  shifts: [],
  activity: [],
  stats: {
    totalShifts: 0,
    totalDoors: 0,
    totalSignups: 0,
    activeReps: 0,
  },
  repNameFallback: new Map(),
};

const els = {
  overlay: document.getElementById("authOverlay"),
  main: document.getElementById("repDashboard"),
  logoutBtn: document.getElementById("logoutBtn"),
  companyName: document.getElementById("companyNameDisplay"),
  statTotalShifts: document.getElementById("statTotalShifts"),
  statTotalDoors: document.getElementById("statTotalDoors"),
  statTotalSignups: document.getElementById("statTotalSignups"),
  statActiveReps: document.getElementById("statActiveReps"),
  recentShiftsBody: document.getElementById("recentShiftsBody"),
  recentActivity: document.getElementById("recentActivity"),
};

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });

function formatDate(dateIso) {
  if (!dateIso) return "—";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    const parts = String(dateIso).split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateIso;
  }
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function mapStatusToLabel(status) {
  switch (status) {
    case "SignUp":
      return { label: "Sale", className: "badge badge-signup" };
    case "O":
      return { label: "Open door", className: "badge badge-open" };
    case "X":
      return { label: "No answer", className: "badge badge-x" };
    case "Pause":
      return { label: "Pause", className: "badge" };
    case "Driving":
      return { label: "Driving", className: "badge" };
    default:
      return { label: status || "Update", className: "badge" };
  }
}

function updateStatsUI() {
  const { totalShifts, totalDoors, totalSignups, activeReps } = state.stats;
  if (els.statTotalShifts) els.statTotalShifts.textContent = numberFormatter.format(totalShifts);
  if (els.statTotalDoors) els.statTotalDoors.textContent = numberFormatter.format(totalDoors);
  if (els.statTotalSignups) els.statTotalSignups.textContent = numberFormatter.format(totalSignups);
  if (els.statActiveReps) els.statActiveReps.textContent = numberFormatter.format(activeReps);
}

function renderShifts() {
  if (!els.recentShiftsBody) return;
  if (!state.shifts.length) {
    els.recentShiftsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No shifts recorded yet.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.shifts.forEach((shift) => {
    const row = document.createElement("tr");

    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(shift.date);
    row.appendChild(dateCell);

    const repCell = document.createElement("td");
    repCell.textContent = shift.repName || shift.repId || "Unknown";
    row.appendChild(repCell);

    const doorsCell = document.createElement("td");
    doorsCell.textContent = numberFormatter.format(shift.totals?.doors || 0);
    row.appendChild(doorsCell);

    const signupCell = document.createElement("td");
    signupCell.textContent = numberFormatter.format(shift.totals?.sales || 0);
    row.appendChild(signupCell);

    const milesCell = document.createElement("td");
    milesCell.textContent = shift.miles ? shift.miles.toFixed(1) : "0";
    row.appendChild(milesCell);

    const payCell = document.createElement("td");
    payCell.textContent = currencyFormatter.format(shift.totalOwed || shift.pay || 0);
    row.appendChild(payCell);

    fragment.appendChild(row);
  });

  els.recentShiftsBody.innerHTML = "";
  els.recentShiftsBody.appendChild(fragment);
}

function renderActivity() {
  if (!els.recentActivity) return;
  if (!state.activity.length) {
    els.recentActivity.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">No recent activity logged.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.activity.forEach((item) => {
    const container = document.createElement("div");
    container.className = "activity-item";

    const timeEl = document.createElement("time");
    timeEl.dateTime = item.timestampIso;
    timeEl.textContent = formatDateTime(item.timestampIso);

    const detailsEl = document.createElement("div");
    const repLine = document.createElement("div");
    repLine.className = "activity-meta";
    repLine.textContent = `${item.repName} • ${item.date}`;
    const statusBadge = document.createElement("span");
    const status = mapStatusToLabel(item.status);
    statusBadge.className = status.className;
    statusBadge.textContent = status.label;

    const summaryEl = document.createElement("div");
    summaryEl.textContent = item.summary || "Door update";

    detailsEl.appendChild(repLine);
    detailsEl.appendChild(statusBadge);
    detailsEl.appendChild(summaryEl);

    const metaEl = document.createElement("div");
    metaEl.className = "activity-meta";
    metaEl.textContent = [item.road, item.note].filter(Boolean).join(" • ") || "";

    container.appendChild(timeEl);
    container.appendChild(detailsEl);
    container.appendChild(metaEl);
    fragment.appendChild(container);
  });

  els.recentActivity.innerHTML = "";
  els.recentActivity.appendChild(fragment);
}

async function fetchRepName(uid) {
  if (!uid) return null;
  if (state.repNameFallback.has(uid)) {
    return state.repNameFallback.get(uid);
  }
  try {
    const snap = await getDoc(doc(collection(db, "users"), uid));
    if (snap.exists()) {
      const data = snap.data();
      const name = data.repName || data.displayName || data.name || data.email || uid;
      state.repNameFallback.set(uid, name);
      return name;
    }
  } catch (error) {
    console.warn("[SubscriberRepDashboard] Failed to resolve rep name", error);
  }
  state.repNameFallback.set(uid, uid);
  return uid;
}

async function loadShifts() {
  const shiftsRef = tenantCollection(db, state.subscriberId, "repShifts");
  const snap = await getDocs(query(shiftsRef, orderBy("date", "desc"), limit(50)));
  const stats = {
    totalShifts: 0,
    totalDoors: 0,
    totalSignups: 0,
    activeReps: new Set(),
  };

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

  const shifts = await Promise.all(snap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const shiftDate = data.date || docSnap.id.split("_")[1];
    const repId = data.repId || docSnap.id.split("_")[0];
    const repName = await fetchRepName(repId);

    const shiftTime = shiftDate ? new Date(shiftDate).getTime() : 0;
    if (shiftTime >= ninetyDaysAgo) {
      stats.totalShifts += 1;
      stats.totalDoors += Number(data.totals?.doors || 0);
      stats.totalSignups += Number(data.totals?.sales || 0);
    }
    if (shiftTime >= thirtyDaysAgo) {
      stats.activeReps.add(repId);
    }

    return {
      id: docSnap.id,
      date: shiftDate,
      repId,
      repName,
      totals: data.totals || {},
      miles: Number(data.miles || data.mileage || 0),
      pay: Number(data.pay || 0),
      totalOwed: Number(data.totalOwed || data.pay || 0),
    };
  }));

  state.shifts = shifts;
  state.stats.totalShifts = stats.totalShifts;
  state.stats.totalDoors = stats.totalDoors;
  state.stats.totalSignups = stats.totalSignups;
  state.stats.activeReps = stats.activeReps.size;

  updateStatsUI();
  renderShifts();
}

async function loadActivity() {
  const activityRef = tenantCollection(db, state.subscriberId, "repLogs");
  const snap = await getDocs(query(activityRef, orderBy("date", "desc"), limit(12)));
  const entries = [];
  const repIds = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const docIdParts = docSnap.id.split("_");
    const repId = data.repId || docIdParts[0];
    const shiftDate = data.date || docIdParts[1];
    const logs = Array.isArray(data.logs) ? data.logs : [];
    repIds.add(repId);

    logs.forEach((log) => {
      const timestampIso = log.timestamp || `${shiftDate}T00:00:00.000Z`;
      const ts = new Date(timestampIso).getTime();
      if (Number.isNaN(ts)) return;
      entries.push({
        timestamp: ts,
        timestampIso,
        repId,
        status: log.status,
        road: [log.houseNumber, log.roadName].filter(Boolean).join(" ") || "",
        note: log.note || log.addressNotes || "",
        date: formatDate(shiftDate),
        summary: log.summary || "Door engagement",
      });
    });
  });

  const nameFetches = Array.from(repIds)
    .filter((repId) => !state.repNameFallback.has(repId))
    .map((repId) => fetchRepName(repId));
  await Promise.all(nameFetches);

  entries.forEach((entry) => {
    entry.repName = state.repNameFallback.get(entry.repId) || entry.repId;
  });

  entries.sort((a, b) => b.timestamp - a.timestamp);
  state.activity = entries.slice(0, 25);
  renderActivity();
}

async function loadDashboard() {
  try {
    await loadShifts();
    await loadActivity();
  } catch (error) {
    console.error("[SubscriberRepDashboard] Failed to load data", error);
    if (els.recentShiftsBody) {
      els.recentShiftsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#f97316;">Unable to load shift data.</td></tr>';
    }
    if (els.recentActivity) {
      els.recentActivity.innerHTML = '<div style="padding:20px;color:#f97316;text-align:center;">Unable to load activity feed.</div>';
    }
  }
}

async function initialise() {
  // Initialize header first and wait for it
  await initSubscriberHeader();
  
  // Attach logout handler after header is injected
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/index.html";
      } catch (error) {
        console.error("[SubscriberRepDashboard] Sign out failed", error);
        alert("Failed to sign out. Please try again.");
      }
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
      state.viewerRole = access.viewerRole;

      if (access.viewerRole === "subscriber" && !access.subscriberProfile.billingCompleted) {
        window.location.href = "./subscriber-billing.html";
        return;
      }

      // Update header with company name and set active tab
      const profile = access.subscriberProfile;
      const companyName = profile.companyName || profile.name || "My Business";
      setCompanyName(companyName);
      setActiveTab('tracking');

      if (els.overlay) {
        els.overlay.style.display = "none";
      }
      if (els.main) {
        els.main.style.display = "block";
      }

      await loadDashboard();
    } catch (error) {
      console.error("[SubscriberRepDashboard] Access error", error);
      alert(error.message || "Unable to load subscriber dashboard");
      await signOut(auth);
      window.location.href = "./subscriber-login.html";
    }
  });
}

initialise();
