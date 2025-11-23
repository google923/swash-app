import { auth, db } from "./firebase-init.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";
import { tenantCollection } from "./lib/subscriber-paths.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
  subscriberId: null,
  shifts: [],
  aggregated: {
    month: { doors: 0, signups: 0, miles: 0 },
    reps30: new Map(),
    weekly: new Map(),
  },
};

const els = {
  overlay: document.getElementById("authOverlay"),
  page: document.getElementById("performancePage"),
  logoutBtn: document.getElementById("logoutBtn"),
  companyName: document.getElementById("companyNameDisplay"),
  metricDoorsMonth: document.getElementById("metricDoorsMonth"),
  metricSignupsMonth: document.getElementById("metricSignupsMonth"),
  metricConversionMonth: document.getElementById("metricConversionMonth"),
  metricMilesMonth: document.getElementById("metricMilesMonth"),
  topRepsBody: document.getElementById("topRepsBody"),
  weeklyTrend: document.getElementById("weeklyTrend"),
};

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const milesFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatWeekLabel(date) {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function updateMetrics() {
  const monthTotals = state.aggregated.month;
  if (els.metricDoorsMonth) els.metricDoorsMonth.textContent = numberFormatter.format(monthTotals.doors);
  if (els.metricSignupsMonth) els.metricSignupsMonth.textContent = numberFormatter.format(monthTotals.signups);
  const conversion = monthTotals.doors > 0 ? monthTotals.signups / monthTotals.doors : 0;
  if (els.metricConversionMonth) els.metricConversionMonth.textContent = percentFormatter.format(conversion);
  if (els.metricMilesMonth) els.metricMilesMonth.textContent = milesFormatter.format(monthTotals.miles);
}

function renderTopReps() {
  if (!els.topRepsBody) return;
  if (!state.aggregated.reps30.size) {
    els.topRepsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">No rep activity recorded in the last 30 days.</td></tr>';
    return;
  }

  const rows = Array.from(state.aggregated.reps30.values())
    .sort((a, b) => b.signups - a.signups || b.doors - a.doors)
    .slice(0, 8)
    .map((rep) => {
      const conversion = rep.doors > 0 ? rep.signups / rep.doors : 0;
      return `<tr>
        <td>${rep.name}</td>
        <td>${numberFormatter.format(rep.doors)}</td>
        <td>${numberFormatter.format(rep.signups)}</td>
        <td>${percentFormatter.format(conversion)}</td>
      </tr>`;
    })
    .join("");

  els.topRepsBody.innerHTML = rows;
}

function renderWeeklyTrend() {
  if (!els.weeklyTrend) return;
  if (!state.aggregated.weekly.size) {
    els.weeklyTrend.innerHTML = '<div class="trend-item" style="color:#94a3b8;">No weekly data available yet.</div>';
    return;
  }

  const items = Array.from(state.aggregated.weekly.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, 6)
    .map(([weekStartMs, totals]) => {
      const date = new Date(weekStartMs);
      const conversion = totals.doors > 0 ? totals.signups / totals.doors : 0;
      return `<div class="trend-item">
        <strong>Week of ${formatWeekLabel(date)}</strong>
        <div class="trend-meta">
          <span>Doors: ${numberFormatter.format(totals.doors)}</span>
          <span>Signups: ${numberFormatter.format(totals.signups)}</span>
          <span>Conv: ${percentFormatter.format(conversion)}</span>
        </div>
      </div>`;
    })
    .join("");

  els.weeklyTrend.innerHTML = items;
}

function resetAggregations() {
  state.aggregated.month = { doors: 0, signups: 0, miles: 0 };
  state.aggregated.reps30.clear();
  state.aggregated.weekly.clear();
}

function accumulateShift(shift) {
  const shiftDate = shift.date ? new Date(shift.date) : null;
  if (!shiftDate || Number.isNaN(shiftDate.getTime())) return;

  const now = new Date();
  const startOfMonthBoundary = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (shiftDate >= startOfMonthBoundary) {
    state.aggregated.month.doors += Number(shift.totals?.doors || 0);
    state.aggregated.month.signups += Number(shift.totals?.sales || 0);
    state.aggregated.month.miles += Number(shift.miles || 0);
  }

  if (shiftDate >= thirtyDaysAgo) {
    const key = shift.repId;
    if (!state.aggregated.reps30.has(key)) {
      state.aggregated.reps30.set(key, {
        id: shift.repId,
        name: shift.repName || shift.repId,
        doors: 0,
        signups: 0,
      });
    }
    const entry = state.aggregated.reps30.get(key);
    entry.doors += Number(shift.totals?.doors || 0);
    entry.signups += Number(shift.totals?.sales || 0);
  }

  const weekStart = startOfWeek(shiftDate).getTime();
  if (!state.aggregated.weekly.has(weekStart)) {
    state.aggregated.weekly.set(weekStart, { doors: 0, signups: 0 });
  }
  const weeklyEntry = state.aggregated.weekly.get(weekStart);
  weeklyEntry.doors += Number(shift.totals?.doors || 0);
  weeklyEntry.signups += Number(shift.totals?.sales || 0);
}

async function loadShifts() {
  const shiftsRef = tenantCollection(db, state.subscriberId, "repShifts");
  const snap = await getDocs(query(shiftsRef, orderBy("date", "desc")));
  state.shifts = snap.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      date: data.date || docSnap.id.split("_")[1],
      repId: data.repId || docSnap.id.split("_")[0],
      repName: data.repName || data.rep || data.repId || docSnap.id.split("_")[0],
      totals: data.totals || {},
      miles: Number(data.miles || data.mileage || 0),
    };
  });
}

function buildAnalytics() {
  resetAggregations();
  state.shifts.forEach(accumulateShift);
  updateMetrics();
  renderTopReps();
  renderWeeklyTrend();
}

async function initialise() {
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/index.html";
      } catch (error) {
        console.error("[SubscriberPerformance] Sign out failed", error);
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

      if (access.viewerRole === "subscriber" && !access.subscriberProfile.billingCompleted) {
        window.location.href = "./subscriber-billing.html";
        return;
      }

      if (els.companyName) {
        const profile = access.subscriberProfile;
        els.companyName.textContent = profile.companyName || profile.name || "";
      }

      if (els.overlay) els.overlay.style.display = "none";
      if (els.page) els.page.style.display = "block";

      await loadShifts();
      buildAnalytics();
    } catch (error) {
      console.error("[SubscriberPerformance] Access error", error);
      alert(error.message || "Unable to load performance dashboard");
      await signOut(auth);
      window.location.href = "./subscriber-login.html";
    }
  });
}

initialise();
