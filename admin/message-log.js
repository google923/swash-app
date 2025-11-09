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
  repFilter: document.getElementById("repFilter"),
};

let state = {
  messages: [],
  filteredMessages: [],
  startDate: null,
  endDate: null,
  typeFilter: "",
  searchTerm: "",
  repFilter: "",
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

    // Query all quotes (no filter needed - just get all)
    const quotesRef = collection(db, "quotes");
    const q = query(quotesRef, orderBy("date", "desc"));
    const snapshot = await getDocs(q);

  const allMessages = [];

    snapshot.forEach((doc) => {
      const quote = doc.data();

      // Skip deleted quotes
      if (quote.deleted) return;

      // Extract emails from emailLog array (only actual sent emails with success/failure tracking)
      if (quote.emailLog && Array.isArray(quote.emailLog)) {
        console.log(`Found ${quote.emailLog.length} emails for ${quote.customerName}`, quote.emailLog);
        quote.emailLog.forEach((log, idx) => {
          const sentBy = log.sentBy || {};
          const repLabel = sentBy.repCode || sentBy.email || "Unknown";
          const repKey = (sentBy.repCode || sentBy.email || "unknown").toString();
          allMessages.push({
            id: `email-${doc.id}-${idx}`,
            type: log.type || "message",
            status: log.success ? "sent" : "failed",
            customerName: quote.customerName || "Unknown",
            email: log.sentTo || quote.email || quote.customerEmail || "—",
            refCode: quote.refCode || "—",
            timestamp: typeof log.sentAt === "number" ? new Date(log.sentAt) : (log.sentAt?.toDate?.() || new Date()),
            subject: log.subject || "Email",
            preview: (log.body ? String(log.body).slice(0, 200) : (log.success ? `Sent successfully to ${log.sentTo}` : `Failed: ${log.error || "Unknown error"}`)),
            body: log.body || "",
            success: log.success,
            error: log.error,
            sentBy: {
              uid: sentBy.uid || null,
              email: sentBy.email || null,
              repCode: sentBy.repCode || null,
              source: sentBy.source || null,
            },
            repLabel,
            repKey,
            _repKeyNorm: repKey.toLowerCase(),
          });
        });
      }
    });
    
    console.log(`Total messages found: ${allMessages.length}`);

    // Sort by timestamp descending
    state.messages = allMessages.sort((a, b) => b.timestamp - a.timestamp);
    state.filteredMessages = [...state.messages];

    // Populate Rep filter options dynamically
    populateRepFilter(state.messages);

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
      const statusBadge = msg.success ? 
        '<span class="badge badge--success" style="background: #dcfce7; color: #14532d;">✓ Sent</span>' : 
        '<span class="badge badge--failed" style="background: #fee2e2; color: #991b1b;">✗ Failed</span>';

      const repInfo = msg.sentBy?.repCode || msg.sentBy?.email || '';
      return `
        <div class="message-log-row ${msg.success ? '' : 'message-log-row--failed'}" data-id="${msg.id}" title="${repInfo ? `Sent by: ${escapeHtml(repInfo)}` : ''}">
          <div class="message-log-cell message-type">
            <span class="badge badge--${msg.type}">${typeLabel}</span>
            ${statusBadge}
          </div>
          <div class="message-log-cell message-customer">
            <div class="customer-name">${escapeHtml(msg.customerName)}</div>
            <div class="customer-email">${escapeHtml(msg.email)}</div>
            ${repInfo ? `<div style="font-size:0.7rem;color:#64748b;">Sent by: ${escapeHtml(repInfo)}</div>` : ''}
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

  // Add click handlers to expand message details
  document.querySelectorAll('.message-log-row').forEach((row) => {
    row.addEventListener('click', () => {
      const msgId = row.dataset.id;
      const msg = messages.find(m => m.id === msgId);
      if (msg) showMessageDetails(msg);
    });
  });

  // Update result count
  elements.tableInfo.hidden = false;
  const countText = messages.length === 1 ? "1 message" : `${messages.length} messages`;
  elements.resultCount.textContent = `Showing ${countText}`;
}

function showMessageDetails(msg) {
  const modal = document.createElement('div');
  modal.className = 'message-detail-modal';
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  `;
  
  const statusBadge = msg.success ? 
    '<span style="background: #dcfce7; color: #14532d; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">✓ Sent</span>' : 
    '<span style="background: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">✗ Failed</span>';
  
  const errorSection = msg.error ? `
    <div style="background: #fee2e2; border: 1px solid #f87171; border-radius: 8px; padding: 12px; margin-top: 12px;">
      <strong style="color: #b91c1c;">Error:</strong>
      <p style="margin: 4px 0 0; color: #991b1b;">${escapeHtml(msg.error)}</p>
    </div>
  ` : '';
  
  modal.innerHTML = `
    <div style="background: #fff; border-radius: 16px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(15, 32, 52, 0.18);">
      <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
          <div style="flex: 1;">
            <h2 style="margin: 0 0 8px; font-size: 1.3rem; color: #1f2937;">${escapeHtml(msg.subject)}</h2>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span style="background: #dbeafe; color: #0c4a6e; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">${getTypeLabel(msg.type)}</span>
              ${statusBadge}
            </div>
          </div>
          <button onclick="this.closest('.message-detail-modal').remove()" style="background: none; border: none; font-size: 24px; color: #64748b; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
        </div>
      </div>
      
      <div style="padding: 24px;">
        <dl style="display: grid; gap: 16px; margin: 0;">
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Customer</dt>
            <dd style="margin: 0; color: #1f2937; font-size: 1rem;">${escapeHtml(msg.customerName)}</dd>
          </div>
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Sent By</dt>
            <dd style="margin: 0; color: #1f2937; font-size: 0.9rem;">
              ${escapeHtml(msg.sentBy?.repCode || msg.sentBy?.email || 'Unknown rep')}
              ${msg.sentBy?.uid ? `<div style='font-size:0.65rem;color:#94a3b8;'>UID: ${escapeHtml(msg.sentBy.uid)}</div>` : ''}
            </dd>
          </div>
          
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Email Address</dt>
            <dd style="margin: 0; color: #0078d7; font-size: 1rem;"><a href="mailto:${escapeHtml(msg.email)}" style="color: #0078d7; text-decoration: none;">${escapeHtml(msg.email)}</a></dd>
          </div>
          
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Reference Code</dt>
            <dd style="margin: 0; color: #1f2937; font-size: 1rem; font-family: monospace;">${escapeHtml(msg.refCode)}</dd>
          </div>
          
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Date & Time</dt>
            <dd style="margin: 0; color: #1f2937; font-size: 1rem;">${formatFullDateTime(msg.timestamp)}</dd>
          </div>
          
          <div>
            <dt style="font-weight: 600; color: #64748b; font-size: 0.85rem; margin-bottom: 4px;">Message</dt>
            <dd style="margin: 0; color: #1f2937; font-size: 0.95rem; line-height: 1.6; background: #f9fafb; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; white-space: pre-wrap;">${escapeHtml(msg.body || msg.preview || "")}</dd>
          </div>
        </dl>
        
        ${errorSection}
      </div>
      
      <div style="padding: 16px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end;">
        <button onclick="this.closest('.message-detail-modal').remove()" style="background: #0078d7; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; cursor: pointer;">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function formatFullDateTime(date) {
  if (!date) return "—";
  if (typeof date === "string") date = new Date(date);
  
  const dateStr = date.toLocaleDateString("en-GB", { 
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeStr = date.toLocaleTimeString("en-GB", { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
  
  return `${dateStr} at ${timeStr}`;
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

  // Rep filter
  if (state.repFilter) {
    const sel = state.repFilter.toLowerCase();
    if (sel === "__unknown") {
      filtered = filtered.filter((msg) => !msg.sentBy?.repCode && !msg.sentBy?.email);
    } else {
      filtered = filtered.filter((msg) => (msg._repKeyNorm || "").includes(sel));
    }
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
    quote: "✉️ Quote",
    sms: "📱 SMS",
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

elements.repFilter?.addEventListener("change", () => {
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

  // Rep filter
  state.repFilter = elements.repFilter?.value || "";

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

function populateRepFilter(messages) {
  if (!elements.repFilter) return;
  const reps = new Map();
  let hasUnknown = false;
  for (const m of messages) {
    const label = m.repLabel || "Unknown";
    const key = m.repKey || (label === "Unknown" ? "__unknown" : label);
    if (label === "Unknown") {
      hasUnknown = true;
    } else if (label) {
      reps.set(label, key);
    }
  }
  const options = [
    { label: "All reps", value: "" },
    ...(hasUnknown ? [{ label: "Unknown", value: "__unknown" }] : []),
    ...Array.from(reps.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value })),
  ];
  elements.repFilter.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
  // Preserve selection if exists
  if (state.repFilter) {
    elements.repFilter.value = state.repFilter;
  }
}
