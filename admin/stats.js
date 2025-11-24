// stats.js - Performance analytics dashboard for Swash Admin

import { app, auth, db } from "../public/firebase-init.js";
import { authStateReady, handlePageRouting } from "../auth-check.js";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const CLEANER_OPTIONS = Array.from({ length: 10 }, (_, i) => `Cleaner ${i + 1}`);
const TARGET_CUSTOMERS_PER_CLEANER = 320;
const TARGET_PRICE_PER_CLEAN = 25;

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  mainContent: document.getElementById("mainContent"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  dateRangeSelect: document.getElementById("dateRangeSelect"),
  customDateLabel: document.getElementById("customDateLabel"),
  customDateLabelTo: document.getElementById("customDateLabelTo"),
  customStartDate: document.getElementById("customStartDate"),
  customEndDate: document.getElementById("customEndDate"),
  refreshBtn: document.getElementById("refreshBtn"),
  // KPI Cards
  totalQuotes: document.getElementById("totalQuotes"),
  conversionRate: document.getElementById("conversionRate"),
  avgQuoteValue: document.getElementById("avgQuoteValue"),
  totalRevenue: document.getElementById("totalRevenue"),
  // Table Bodies
  repTableBody: document.getElementById("repTableBody"),
  densityTableBody: document.getElementById("densityTableBody"),
  densityContainer: document.getElementById("densityContainer"),
  pricingTableBody: document.getElementById("pricingTableBody"),
  pricingContainer: document.getElementById("pricingContainer"),
};

const state = {
  allQuotes: [],
  filteredQuotes: [],
  dateRange: "30days",
  customStartDate: null,
  customEndDate: null,
  loading: false,
};

// ===== UTILITY FUNCTIONS =====

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function parseDate(input) {
  if (!input) return null;
  if (input.toDate) return input.toDate();
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateRange() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  let start = new Date();
  start.setHours(0, 0, 0, 0);

  const range = state.dateRange;

  if (range === "30days") {
    start.setDate(start.getDate() - 30);
  } else if (range === "month") {
    start.setDate(1);
  } else if (range === "quarter") {
    const quarter = Math.floor(start.getMonth() / 3);
    start.setMonth(quarter * 3, 1);
  } else if (range === "year") {
    start.setMonth(0, 1);
  } else if (range === "custom" && state.customStartDate && state.customEndDate) {
    start = new Date(state.customStartDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(state.customEndDate);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function filterQuotesByDateRange(quotes) {
  const { start, end } = getDateRange();
  return quotes.filter((q) => {
    const quoteDate = parseDate(q.date);
    return quoteDate && quoteDate >= start && quoteDate <= end;
  });
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

function isQuoteBooked(quote) {
  const status = (quote.status || "").toString().toLowerCase();
  return quote.bookedDate ? true : /booked/.test(status);
}

// ===== DATA CALCULATION FUNCTIONS =====

function calculateRepStats(quotes) {
  const repMap = new Map();

  quotes.forEach((quote) => {
    const repCode = (quote.repCode || "UNKNOWN").toUpperCase();

    if (!repMap.has(repCode)) {
      repMap.set(repCode, {
        repCode,
        totalQuotes: 0,
        bookedQuotes: 0,
        totalValue: 0,
        avgPrice: 0,
      });
    }

    const rep = repMap.get(repCode);
    rep.totalQuotes += 1;

    if (isQuoteBooked(quote)) {
      rep.bookedQuotes += 1;
    }

    const pricePerClean = resolvePricePerClean(quote);
    rep.totalValue += pricePerClean;
  });

  // Calculate averages
  const reps = Array.from(repMap.values());
  reps.forEach((rep) => {
    rep.avgPrice = rep.totalQuotes > 0 ? rep.totalValue / rep.totalQuotes : 0;
    rep.conversionRate = rep.totalQuotes > 0 ? (rep.bookedQuotes / rep.totalQuotes) * 100 : 0;
  });

  return reps.sort((a, b) => b.totalQuotes - a.totalQuotes);
}

function calculateCleanerDensity(quotes) {
  const cleanerMap = new Map();

  CLEANER_OPTIONS.forEach((cleaner) => {
    cleanerMap.set(cleaner, {
      cleaner,
      assignedCount: 0,
      bookedCount: 0,
      totalPrice: 0,
    });
  });

  quotes.forEach((quote) => {
    if (quote.assignedCleaner && CLEANER_OPTIONS.includes(quote.assignedCleaner)) {
      const data = cleanerMap.get(quote.assignedCleaner);
      data.assignedCount += 1;

      if (isQuoteBooked(quote)) {
        data.bookedCount += 1;
      }

      data.totalPrice += resolvePricePerClean(quote);
    }
  });

  const cleaners = Array.from(cleanerMap.values());
  cleaners.forEach((c) => {
    c.percentOfTarget = (c.assignedCount / TARGET_CUSTOMERS_PER_CLEANER) * 100;
    c.avgPerWeek = Math.round(c.assignedCount / 4);
    c.efficiency = Math.min(100, c.percentOfTarget);
  });

  return cleaners;
}

function calculateCleanerPricing(quotes) {
  const cleanerMap = new Map();

  CLEANER_OPTIONS.forEach((cleaner) => {
    cleanerMap.set(cleaner, {
      cleaner,
      totalQuotes: 0,
      totalPrice: 0,
      bookedCount: 0,
    });
  });

  quotes.forEach((quote) => {
    if (quote.assignedCleaner && CLEANER_OPTIONS.includes(quote.assignedCleaner)) {
      const data = cleanerMap.get(quote.assignedCleaner);
      data.totalQuotes += 1;

      const pricePerClean = resolvePricePerClean(quote);
      data.totalPrice += pricePerClean;

      if (isQuoteBooked(quote)) {
        data.bookedCount += 1;
      }
    }
  });

  const cleaners = Array.from(cleanerMap.values());
  cleaners.forEach((c) => {
    c.avgPrice = c.totalQuotes > 0 ? c.totalPrice / c.totalQuotes : 0;
    c.priceVariance = c.avgPrice - TARGET_PRICE_PER_CLEAN;
    c.pricePercent = (c.avgPrice / TARGET_PRICE_PER_CLEAN) * 100;
    c.projectedRevenue = c.totalQuotes * c.avgPrice * 3; // 3 cleans per customer
    c.profitability = Math.min(100, (c.avgPrice / TARGET_PRICE_PER_CLEAN) * 100);
  });

  return cleaners;
}

function getCleanerStatus(value, target) {
  const percent = (value / target) * 100;
  if (percent >= 90 && percent <= 110) return "on-target";
  if (percent < 90) return "warning";
  return "critical";
}

// ===== RENDERING FUNCTIONS =====

function updateKPIs() {
  const quotes = state.filteredQuotes;

  const totalQuotes = quotes.length;
  const bookedQuotes = quotes.filter(isQuoteBooked).length;
  const conversionRate = totalQuotes > 0 ? (bookedQuotes / totalQuotes) * 100 : 0;

  const totalValue = quotes.reduce((sum, q) => sum + resolvePricePerClean(q), 0);
  const avgValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

  elements.totalQuotes.textContent = totalQuotes.toString();
  elements.conversionRate.textContent = formatPercent(conversionRate);
  elements.avgQuoteValue.textContent = formatCurrency(avgValue);
  elements.totalRevenue.textContent = formatCurrency(totalValue);
}

function renderRepStats() {
  const reps = calculateRepStats(state.filteredQuotes);

  if (!reps.length) {
    elements.repTableBody.innerHTML =
      '<tr><td colspan="7" class="no-data">No data available</td></tr>';
    return;
  }

  elements.repTableBody.innerHTML = reps
    .map((rep) => {
      const statusClass = rep.conversionRate >= 75 ? "status-ontarget" : "status-warning";
      return `
      <tr>
        <td class="name-cell">${escapeHtml(rep.repCode)}</td>
        <td class="number-cell">${rep.totalQuotes}</td>
        <td class="number-cell">${rep.bookedQuotes}</td>
        <td class="percentage-cell">${formatPercent(rep.conversionRate)}</td>
        <td class="number-cell">${formatCurrency(rep.avgPrice)}</td>
        <td class="number-cell">${formatCurrency(rep.totalValue)}</td>
        <td><span class="status-badge ${statusClass}">${rep.conversionRate >= 75 ? "✓ On Track" : "⚠ Below Target"}</span></td>
      </tr>
    `;
    })
    .join("");
}

function renderDensitySection() {
  const cleaners = calculateCleanerDensity(state.filteredQuotes);

  // Render progress bars
  const progressHtml = cleaners
    .map((c) => {
      const fillPercent = Math.min(100, c.percentOfTarget);
      const progressClass =
        c.percentOfTarget >= 90 && c.percentOfTarget <= 110
          ? ""
          : c.percentOfTarget < 90
            ? "warning"
            : "critical";

      return `
      <div class="progress-container">
        <div class="progress-label">
          <span>${escapeHtml(c.cleaner)}</span>
          <span>${c.assignedCount} / ${TARGET_CUSTOMERS_PER_CLEANER} (${formatPercent(c.percentOfTarget)})</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${progressClass}" style="width: ${fillPercent}%"></div>
        </div>
      </div>
    `;
    })
    .join("");

  elements.densityContainer.innerHTML = progressHtml;

  // Render table
  if (!cleaners.length) {
    elements.densityTableBody.innerHTML =
      '<tr><td colspan="6" class="no-data">No data available</td></tr>';
    return;
  }

  elements.densityTableBody.innerHTML = cleaners
    .map((c) => {
      const status = getCleanerStatus(c.assignedCount, TARGET_CUSTOMERS_PER_CLEANER);
      const statusMap = {
        "on-target": "status-ontarget",
        warning: "status-warning",
        critical: "status-critical",
      };
      const statusBadge =
        status === "on-target"
          ? "✓ On Target"
          : status === "warning"
            ? "⚠ Under"
            : "🔴 Over";

      return `
      <tr>
        <td class="name-cell">${escapeHtml(c.cleaner)}</td>
        <td class="number-cell">${c.assignedCount}</td>
        <td class="percentage-cell">${formatPercent(c.percentOfTarget)}</td>
        <td class="number-cell">${c.avgPerWeek}</td>
        <td class="percentage-cell">${formatPercent(c.efficiency)}</td>
        <td><span class="status-badge ${statusMap[status]}">${statusBadge}</span></td>
      </tr>
    `;
    })
    .join("");
}

function renderPricingSection() {
  const cleaners = calculateCleanerPricing(state.filteredQuotes);

  // Render progress bars
  const progressHtml = cleaners
    .map((c) => {
      const fillPercent = Math.min(100, c.pricePercent);
      const progressClass =
        c.pricePercent >= 90 && c.pricePercent <= 110
          ? ""
          : c.pricePercent < 90
            ? "warning"
            : "critical";

      return `
      <div class="progress-container">
        <div class="progress-label">
          <span>${escapeHtml(c.cleaner)}</span>
          <span>${formatCurrency(c.avgPrice)} / ${formatCurrency(TARGET_PRICE_PER_CLEAN)} (${formatPercent(c.pricePercent)})</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${progressClass}" style="width: ${fillPercent}%"></div>
        </div>
      </div>
    `;
    })
    .join("");

  elements.pricingContainer.innerHTML = progressHtml;

  // Render table
  if (!cleaners.length) {
    elements.pricingTableBody.innerHTML =
      '<tr><td colspan="6" class="no-data">No data available</td></tr>';
    return;
  }

  elements.pricingTableBody.innerHTML = cleaners
    .map((c) => {
      const status = getCleanerStatus(c.avgPrice, TARGET_PRICE_PER_CLEAN);
      const statusMap = {
        "on-target": "status-ontarget",
        warning: "status-warning",
        critical: "status-critical",
      };
      const statusBadge =
        status === "on-target"
          ? "✓ On Target"
          : status === "warning"
            ? "⚠ Below"
            : "🟢 Premium";

      return `
      <tr>
        <td class="name-cell">${escapeHtml(c.cleaner)}</td>
        <td class="number-cell">${formatCurrency(c.avgPrice)}</td>
        <td class="percentage-cell">${c.priceVariance >= 0 ? "+" : ""}${formatCurrency(c.priceVariance)}</td>
        <td class="number-cell">${formatCurrency(c.projectedRevenue)}</td>
        <td class="percentage-cell">${formatPercent(c.profitability)}</td>
        <td><span class="status-badge ${statusMap[status]}">${statusBadge}</span></td>
      </tr>
    `;
    })
    .join("");
}

function renderAllStats() {
  state.filteredQuotes = filterQuotesByDateRange(state.allQuotes);
  updateKPIs();
  renderRepStats();
  renderDensitySection();
  renderPricingSection();
}

// ===== DATA LOADING =====

async function loadAllQuotes() {
  try {
    state.loading = true;
    elements.refreshBtn.disabled = true;

    const quotesRef = collection(db, "quotes");
    const snapshot = await getDocs(quotesRef);

    state.allQuotes = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((q) => !q.deleted);

    renderAllStats();
  } catch (error) {
    console.error("Failed to load quotes:", error);
  } finally {
    state.loading = false;
    elements.refreshBtn.disabled = false;
  }
}

// ===== EVENT HANDLERS =====

function setupMenuToggle() {
  elements.menuBtn.addEventListener("click", () => {
    window.location.href = "/main.html";
  });
}

function setupDateRangeFilter() {
  elements.dateRangeSelect.addEventListener("change", (e) => {
    state.dateRange = e.target.value;

    if (state.dateRange === "custom") {
      elements.customDateLabel.removeAttribute("hidden");
      elements.customDateLabelTo.removeAttribute("hidden");
    } else {
      elements.customDateLabel.setAttribute("hidden", "");
      elements.customDateLabelTo.setAttribute("hidden", "");
    }

    renderAllStats();
  });

  elements.customStartDate.addEventListener("change", (e) => {
    state.customStartDate = e.target.value;
    renderAllStats();
  });

  elements.customEndDate.addEventListener("change", (e) => {
    state.customEndDate = e.target.value;
    renderAllStats();
  });
}

function setupRefreshButton() {
  elements.refreshBtn.addEventListener("click", loadAllQuotes);
}

function setupLogout() {
  elements.logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  });
}

function showAuthOverlay(show) {
  if (show) {
    elements.authOverlay.removeAttribute("hidden");
  } else {
    elements.authOverlay.setAttribute("hidden", "");
  }
  elements.mainContent.hidden = show;
}

function setLoginError(message = "") {
  if (message) {
    elements.loginError.textContent = message;
    elements.loginError.removeAttribute("hidden");
  } else {
    elements.loginError.textContent = "";
    elements.loginError.setAttribute("hidden", "");
  }
}

function setupLoginForm() {
  if (!elements.loginForm) return;

  elements.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setLoginError("");

    const email = elements.loginEmail.value.trim();
    const password = elements.loginPassword.value;

    if (!email || !password) {
      setLoginError("Please enter email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setLoginError("");
      elements.loginEmail.value = "";
      elements.loginPassword.value = "";
    } catch (error) {
      console.error("Login failed:", error);
      if (error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        setLoginError("Invalid email or password.");
      } else if (error.code === "auth/too-many-requests") {
        setLoginError("Too many attempts. Try again later.");
      } else {
        setLoginError("Sign in failed. Please try again.");
      }
    }
  });
}

// ===== INITIALIZATION =====

async function initStatsPage() {
  console.log("[Stats] Initializing...");

  setupMenuToggle();
  setupDateRangeFilter();
  setupRefreshButton();
  setupLogout();
  setupLoginForm();

  // Load initial data
  await loadAllQuotes();

  console.log("[Stats] Ready");
}

// ===== AUTH STATE MANAGEMENT =====

async function bootstrapStatsPage() {
  await authStateReady();
  console.log("[Stats] Auth ready");

  const routing = await handlePageRouting("shared");
  if (routing.redirected) return;

  setupLoginForm();

  onAuthStateChanged(auth, (user) => {
    if (user) {
      setLoginError("");
      showAuthOverlay(false);
      initStatsPage().catch((error) => {
        console.error("Stats init failed:", error);
        setLoginError("Unable to load data. Please try again.");
        showAuthOverlay(true);
      });
    } else {
      showAuthOverlay(true);
      elements.loginEmail?.focus();
    }
  });
}

bootstrapStatsPage();
