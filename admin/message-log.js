import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDH7C2gV-EFpqvOO9u5lSKJmA_f5_nRCIo",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.appspot.com",
  messagingSenderId: "809944968159",
  appId: "1:809944968159:web:aaac81a98a61c2a9c47acb",
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}

const db = getFirestore();
const auth = getAuth();

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  logContent: document.getElementById("logContent"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  messageLogTable: document.getElementById("messageLogTable"),
  tableInfo: document.getElementById("tableInfo"),
  resultCount: document.getElementById("resultCount"),
  logStartDate: document.getElementById("logStartDate"),
  logEndDate: document.getElementById("logEndDate"),
  filterBtn: document.getElementById("filterBtn"),
  clearFilterBtn: document.getElementById("clearFilterBtn"),
  messageTypeFilter: document.getElementById("messageTypeFilter"),
  messageSearch: document.getElementById("messageSearch"),
};

let state = {
  messages: [],
  filteredMessages: [],
  startDate: null,
  endDate: null,
  typeFilter: "",
  searchTerm: "",
};

// ===== AUTHENTICATION =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // User is logged in
    elements.authOverlay.hidden = true;
    elements.logContent.hidden = false;
    elements.logoutBtn.hidden = false;
    await loadMessageLog();
  } else {
    // User is not logged in
    elements.authOverlay.hidden = false;
    elements.logContent.hidden = true;
    elements.logoutBtn.hidden = true;
  }
});

elements.loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = elements.loginEmail.value;
  const password = elements.loginPassword.value;

  try {
    const { signInWithEmailAndPassword } = await import(
      "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js"
    );
    await signInWithEmailAndPassword(auth, email, password);
    elements.loginForm.reset();
    elements.loginError.hidden = true;
  } catch (error) {
    elements.loginError.textContent = error.message || "Sign in failed";
    elements.loginError.hidden = false;
  }
});

elements.logoutBtn?.addEventListener("click", async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Sign out failed:", error);
  }
});

// ===== MESSAGE LOG LOADING =====
async function loadMessageLog() {
  try {
    elements.messageLogTable.innerHTML = '<div class="table-loading">Loading messages...</div>';

    // Query quotes with any sent messages or emails
    const quotesRef = collection(db, "quotes");
    const q = query(quotesRef, where("__name__", "!=", ""));
    const snapshot = await getDocs(q);

    const allMessages = [];

    snapshot.forEach((doc) => {
      const quote = doc.data();

      // Extract booking confirmations from status history
      if (quote.bookedDate) {
        allMessages.push({
          id: `booking-${doc.id}`,
          type: "booking",
          status: "booking",
          customerName: quote.customerName || "Unknown",
          email: quote.email || quote.customerEmail || "—",
          refCode: quote.refCode || "—",
          timestamp: quote.date ? Timestamp.fromMillis(quote.date).toDate() : new Date(quote.bookedDate),
          subject: `Booking confirmation for ${quote.customerName}`,
          preview: `Clean scheduled at ${quote.address || "Unknown address"}`,
        });
      }

      // Extract day messages from messageLog if available
      if (quote.messageLog && Array.isArray(quote.messageLog)) {
        quote.messageLog.forEach((msg, idx) => {
          allMessages.push({
            id: `message-${doc.id}-${idx}`,
            type: "message",
            status: "message",
            customerName: quote.customerName || "Unknown",
            email: quote.email || quote.customerEmail || "—",
            refCode: quote.refCode || "—",
            timestamp: msg.sentAt ? (typeof msg.sentAt === "object" ? msg.sentAt.toDate?.() : new Date(msg.sentAt)) : new Date(),
            subject: msg.title || "Message",
            preview: msg.message?.substring(0, 100) || "—",
          });
        });
      }

      // Extract completion receipts if marked as done
      if (quote.completedDate) {
        allMessages.push({
          id: `receipt-${doc.id}`,
          type: "receipt",
          status: "receipt",
          customerName: quote.customerName || "Unknown",
          email: quote.email || quote.customerEmail || "—",
          refCode: quote.refCode || "—",
          timestamp: typeof quote.completedDate === "object" ? quote.completedDate.toDate?.() : new Date(quote.completedDate),
          subject: `Cleaning receipt for ${quote.customerName}`,
          preview: "Cleaning completed receipt",
        });
      }
    });

    // Sort by timestamp descending
    state.messages = allMessages.sort((a, b) => b.timestamp - a.timestamp);
    state.filteredMessages = [...state.messages];

    renderMessageLog();
  } catch (error) {
    console.error("Failed to load message log:", error);
    elements.messageLogTable.innerHTML = `<div class="error-message">Error loading messages: ${error.message}</div>`;
  }
}

function renderMessageLog() {
  const messages = applyFilters();

  if (messages.length === 0) {
    elements.messageLogTable.innerHTML = '<div class="empty-state">No messages found.</div>';
    elements.tableInfo.hidden = true;
    return;
  }

  const rows = messages
    .map((msg) => {
      const typeLabel = getTypeLabel(msg.type);
      const dateStr = formatDateTime(msg.timestamp);
      const preview = escapeHtml(msg.preview);

      return `
        <div class="message-log-row" data-id="${msg.id}">
          <div class="message-log-cell message-type">
            <span class="badge badge--${msg.type}">${typeLabel}</span>
          </div>
          <div class="message-log-cell message-customer">
            <div class="customer-name">${escapeHtml(msg.customerName)}</div>
            <div class="customer-email">${escapeHtml(msg.email)}</div>
          </div>
          <div class="message-log-cell message-content">
            <div class="message-subject">${escapeHtml(msg.subject)}</div>
            <div class="message-preview">${preview}</div>
          </div>
          <div class="message-log-cell message-date">
            <div class="date-time">${dateStr}</div>
            <div class="ref-code">${escapeHtml(msg.refCode)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  elements.messageLogTable.innerHTML = `<div class="message-log-list">${rows}</div>`;

  // Update result count
  elements.tableInfo.hidden = false;
  const countText = messages.length === 1 ? "1 message" : `${messages.length} messages`;
  elements.resultCount.textContent = `Showing ${countText}`;
}

function applyFilters() {
  let filtered = [...state.messages];

  // Date range filter
  if (state.startDate) {
    filtered = filtered.filter((msg) => msg.timestamp >= state.startDate);
  }
  if (state.endDate) {
    const endOfDay = new Date(state.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    filtered = filtered.filter((msg) => msg.timestamp <= endOfDay);
  }

  // Type filter
  if (state.typeFilter) {
    filtered = filtered.filter((msg) => msg.type === state.typeFilter);
  }

  // Search filter
  if (state.searchTerm) {
    const term = state.searchTerm.toLowerCase();
    filtered = filtered.filter((msg) => 
      msg.customerName.toLowerCase().includes(term) ||
      msg.email.toLowerCase().includes(term) ||
      msg.refCode.toLowerCase().includes(term)
    );
  }

  return filtered;
}

function getTypeLabel(type) {
  const labels = {
    booking: "📧 Booking",
    message: "💬 Message",
    reminder: "🔔 Reminder",
    receipt: "✓ Receipt",
  };
  return labels[type] || type;
}

function formatDateTime(date) {
  if (!date) return "—";
  if (typeof date === "string") date = new Date(date);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = date.toLocaleDateString("en-GB");
  const todayStr = today.toLocaleDateString("en-GB");
  const yesterdayStr = yesterday.toLocaleDateString("en-GB");

  let dateLabel;
  if (dateOnly === todayStr) {
    dateLabel = "Today";
  } else if (dateOnly === yesterdayStr) {
    dateLabel = "Yesterday";
  } else {
    dateLabel = date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  }

  const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return `${dateLabel}<br><span style="font-size: 0.85rem; color: #64748b;">${timeStr}</span>`;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== EVENT LISTENERS =====
elements.filterBtn?.addEventListener("click", () => {
  applyUserFilters();
  renderMessageLog();
});

elements.clearFilterBtn?.addEventListener("click", () => {
  elements.logStartDate.value = "";
  elements.logEndDate.value = "";
  elements.messageTypeFilter.value = "";
  elements.messageSearch.value = "";
  state.startDate = null;
  state.endDate = null;
  state.typeFilter = "";
  state.searchTerm = "";
  renderMessageLog();
});

elements.messageTypeFilter?.addEventListener("change", () => {
  applyUserFilters();
  renderMessageLog();
});

elements.messageSearch?.addEventListener("input", () => {
  applyUserFilters();
  renderMessageLog();
});

function applyUserFilters() {
  // Date filters
  if (elements.logStartDate.value) {
    state.startDate = new Date(elements.logStartDate.value + "T00:00:00Z");
  } else {
    state.startDate = null;
  }

  if (elements.logEndDate.value) {
    state.endDate = new Date(elements.logEndDate.value + "T00:00:00Z");
  } else {
    state.endDate = null;
  }

  // Type filter
  state.typeFilter = elements.messageTypeFilter.value;

  // Search filter
  state.searchTerm = elements.messageSearch.value.trim();
}

// Set default date range (last 30 days)
function setDefaultDateRange() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  elements.logStartDate.value = thirtyDaysAgo.toISOString().split("T")[0];
  elements.logEndDate.value = today.toISOString().split("T")[0];

  state.startDate = new Date(thirtyDaysAgo);
  state.startDate.setHours(0, 0, 0, 0);

  state.endDate = new Date(today);
  state.endDate.setHours(23, 59, 59, 999);
}

// Initialize
setDefaultDateRange();
