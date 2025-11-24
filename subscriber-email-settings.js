import { app, auth, db } from "./public/firebase-init.js";
import { initSubscriberHeader, setCompanyName, setActiveTab } from "./public/header-template.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";
import { tenantCollection, tenantDoc } from "./lib/subscriber-paths.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";

const functions = getFunctions(app, "us-central1");

const state = {
  subscriberId: null,
  userProfile: null,
  viewerRole: null,
  settings: null,
};

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  emailContent: document.getElementById("emailContent"),
  logoutBtn: document.getElementById("logoutBtn"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  statusBadge: document.getElementById("statusBadge"),
  settingsForm: document.getElementById("settingsForm"),
  smtpHost: document.getElementById("smtpHost"),
  smtpPort: document.getElementById("smtpPort"),
  fromName: document.getElementById("fromName"),
  fromEmail: document.getElementById("fromEmail"),
  smtpUsername: document.getElementById("smtpUsername"),
  smtpPassword: document.getElementById("smtpPassword"),
  minSend: document.getElementById("minSend"),
  requireAuth: document.getElementById("requireAuth"),
  useStartTls: document.getElementById("useStartTls"),
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  passwordHint: document.getElementById("passwordHint"),
  testForm: document.getElementById("testForm"),
  testRecipient: document.getElementById("testRecipient"),
  testSubject: document.getElementById("testSubject"),
  testMessage: document.getElementById("testMessage"),
  sendTestBtn: document.getElementById("sendTestBtn"),
  testStatus: document.getElementById("testStatus"),
  logsContainer: document.getElementById("logsContainer"),
};

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-GB", { hour12: false });
  } catch (_) {
    return "";
  }
}

function setStatusBadge(status = "pending", message = "Not configured") {
  if (!elements.statusBadge) return;
  const classes = ["status-badge"];
  if (status === "ok") classes.push("status-ok");
  else if (status === "error") classes.push("status-error");
  else classes.push("status-pending");
  elements.statusBadge.className = classes.join(" ");
  elements.statusBadge.textContent = message;
}

function toggleAuthFields(enabled) {
  elements.smtpUsername.disabled = !enabled;
  elements.smtpPassword.disabled = !enabled;
}

function populateForm(settings) {
  if (!settings) {
    setStatusBadge("pending", "Not configured yet");
    elements.smtpPort.value = "465";
    elements.requireAuth.checked = true;
    toggleAuthFields(true);
    elements.passwordHint.textContent = "Passwords are stored securely and never shown after saving.";
    return;
  }

  const lastError = settings.lastErrorMessage ? `Last error: ${settings.lastErrorMessage}` : "";
  const lastSent = settings.lastSentAt ? formatTimestamp(settings.lastSentAt) : "";

  if (settings.lastErrorMessage) {
    setStatusBadge("error", "Check settings - last send failed");
  } else if (settings.lastSentAt) {
    setStatusBadge("ok", `Ready • last send ${lastSent}`);
  } else {
    setStatusBadge("pending", "Configured but not used yet");
  }

  elements.smtpHost.value = settings.host || "";
  elements.smtpPort.value = settings.port ?? "";
  elements.fromName.value = settings.fromName || "";
  elements.fromEmail.value = settings.fromEmail || "";
  elements.smtpUsername.value = settings.username || "";
  elements.requireAuth.checked = settings.requireAuth !== false;
  elements.useStartTls.checked = Boolean(settings.useStartTls);
  elements.minSend.value = settings.minSendMinutes ?? 0;
  toggleAuthFields(elements.requireAuth.checked);

  const passwordUpdated = settings.passwordUpdatedAt ? formatTimestamp(settings.passwordUpdatedAt) : "Not saved yet";
  const hints = [];
  hints.push(`Password last updated: ${passwordUpdated}`);
  if (lastError) hints.push(lastError);
  if (lastSent) hints.push(`Last email sent: ${lastSent}`);
  elements.passwordHint.textContent = hints.join(" • ");
}

function canManageSettings() {
  if (state.viewerRole === "admin") return true;
  if (state.viewerRole === "subscriber" && state.userProfile?.id === state.subscriberId) return true;
  return false;
}

async function loadSettings() {
  if (!state.subscriberId) return;
  try {
    const settingsRef = tenantDoc(db, state.subscriberId, "private", "emailSettings");
    const snap = await getDoc(settingsRef);
    state.settings = snap.exists() ? snap.data() : null;
    populateForm(state.settings);
    await loadLogs();
  } catch (error) {
    console.error("Failed to load email settings", error);
    setStatusBadge("error", "Unable to load settings");
  }
}

async function loadLogs() {
  if (!state.subscriberId) return;
  try {
    const logsRef = tenantCollection(db, state.subscriberId, "emailLogs");
    const q = query(logsRef, orderBy("sentAt", "desc"), limit(6));
    const snap = await getDocs(q);

    if (snap.empty) {
      elements.logsContainer.innerHTML = '<p style="color:#64748b;">No emails have been sent yet.</p>';
      return;
    }

    const rows = snap.docs.map((docSnap) => {
      const data = docSnap.data();
      const status = data.status === "sent" ? "✅ Sent" : "⚠️ Error";
      const sentAt = data.sentAt ? formatTimestamp(data.sentAt) : "";
      const subject = data.subject || "(no subject)";
      const to = data.to || "";
      const errorText = data.status === "error" && data.error ? `<div style="color:#b91c1c;font-size:13px;margin-top:4px;">${escapeHtml(data.error)}</div>` : "";
      return `<div style="border-bottom:1px solid #e2e8f0;padding:10px 0;">
        <div style="display:flex;justify-content:space-between;gap:12px;">
          <strong style="color:#1e293b;">${escapeHtml(subject)}</strong>
          <span style="color:#64748b;font-size:13px;">${sentAt}</span>
        </div>
        <div style="color:#475569;font-size:13px;margin-top:4px;">${status} • ${escapeHtml(to)}</div>
        ${errorText}
      </div>`;
    }).join("");

    elements.logsContainer.innerHTML = rows;
  } catch (error) {
    console.error("Failed to load email logs", error);
    elements.logsContainer.innerHTML = '<p style="color:#b91c1c;">Unable to load activity.</p>';
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/["&'<>]/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function gatherSettingsFromForm() {
  const host = elements.smtpHost.value.trim();
  const port = Number.parseInt(elements.smtpPort.value, 10);
  const fromName = elements.fromName.value.trim();
  const fromEmail = elements.fromEmail.value.trim();
  const requireAuth = elements.requireAuth.checked;
  const username = requireAuth ? elements.smtpUsername.value.trim() : "";
  const minSendMinutes = Number.parseInt(elements.minSend.value || "0", 10) || 0;

  if (!host) {
    throw new Error("SMTP host is required");
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error("Enter a valid SMTP port");
  }
  if (!fromEmail) {
    throw new Error("From email is required");
  }
  if (requireAuth && !username) {
    throw new Error("SMTP username is required when authentication is enabled");
  }

  return {
    host,
    port,
    fromName,
    fromEmail,
    username,
    requireAuth,
    useStartTls: elements.useStartTls.checked,
    minSendMinutes,
  };
}

async function handleSave(event) {
  event.preventDefault();
  if (!state.subscriberId) return;
  if (!canManageSettings()) {
    elements.saveStatus.textContent = "Only the subscriber owner can update these settings.";
    return;
  }

  elements.saveBtn.disabled = true;
  elements.saveStatus.textContent = "Saving...";

  try {
    const payload = {
      settings: gatherSettingsFromForm(),
    };
    const password = elements.smtpPassword.value.trim();
    if (password) {
      payload.password = password;
    }
    if (state.userProfile?.role === "admin" && state.subscriberId !== state.userProfile.id) {
      payload.subscriberId = state.subscriberId;
    }

    const callable = httpsCallable(functions, "saveSubscriberEmailSettings");
    await callable(payload);

    elements.smtpPassword.value = "";
    elements.saveStatus.textContent = "Settings saved";
    await loadSettings();
  } catch (error) {
    console.error("Failed to save settings", error);
    const message = error?.message || "Unable to save settings";
    elements.saveStatus.textContent = message;
    setStatusBadge("error", "Save failed");
  } finally {
    elements.saveBtn.disabled = false;
    setTimeout(() => {
      if (elements.saveStatus.textContent.startsWith("Settings saved")) {
        elements.saveStatus.textContent = "";
      }
    }, 3000);
  }
}

async function handleSendTest(event) {
  event.preventDefault();
  if (!state.subscriberId) return;
  if (!canManageSettings()) {
    elements.testStatus.textContent = "Only the subscriber owner can send test emails.";
    return;
  }

  elements.sendTestBtn.disabled = true;
  elements.testStatus.textContent = "Sending...";

  try {
    const to = elements.testRecipient.value.trim();
    const subject = elements.testSubject.value.trim();
    const text = elements.testMessage.value.trim() || "Hello! This is a test email from Swash.";

    const payload = {
      email: {
        to,
        subject,
        text,
        metadata: { type: "test" },
      },
    };
    if (state.userProfile?.role === "admin" && state.subscriberId !== state.userProfile.id) {
      payload.subscriberId = state.subscriberId;
    }

    const callable = httpsCallable(functions, "sendSubscriberEmail");
    await callable(payload);

    elements.testStatus.textContent = "Test email sent";
    await loadLogs();
  } catch (error) {
    console.error("Failed to send test email", error);
    const message = error?.message || "Unable to send test email";
    elements.testStatus.textContent = message;
    setStatusBadge("error", "Send failed");
  } finally {
    elements.sendTestBtn.disabled = false;
    setTimeout(() => {
      if (elements.testStatus.textContent.startsWith("Test email sent")) {
        elements.testStatus.textContent = "";
      }
    }, 4000);
  }
}

function initUiHandlers() {
  elements.logoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "./subscriber-login.html";
  });

  elements.menuBtn?.addEventListener("click", () => {
    window.location.href = "/main.html";
  });

  elements.requireAuth.addEventListener("change", () => {
    toggleAuthFields(elements.requireAuth.checked);
  });

  elements.settingsForm.addEventListener("submit", handleSave);
  elements.testForm.addEventListener("submit", handleSendTest);
}

async function bootstrap(user) {
  const access = await ensureSubscriberAccess(user);
  state.userProfile = access.viewerProfile;
  state.viewerRole = access.viewerRole;
  state.subscriberId = access.subscriberId;

  if (access.viewerRole === "subscriber" && !access.viewerProfile.billingCompleted) {
    window.location.href = "./subscriber-billing.html";
    return;
  }

  if (elements.authOverlay) {
    elements.authOverlay.style.display = "none";
  }
  if (elements.emailContent) {
    elements.emailContent.style.display = "block";
  }

  await loadSettings();

  if (!canManageSettings()) {
    elements.saveStatus.textContent = "You have read-only access. Ask the account owner to update settings.";
    elements.smtpHost?.setAttribute("disabled", "true");
    elements.smtpPort?.setAttribute("disabled", "true");
    elements.fromName?.setAttribute("disabled", "true");
    elements.fromEmail?.setAttribute("disabled", "true");
    elements.smtpUsername?.setAttribute("disabled", "true");
    elements.smtpPassword?.setAttribute("disabled", "true");
    elements.minSend?.setAttribute("disabled", "true");
    elements.requireAuth?.setAttribute("disabled", "true");
    elements.useStartTls?.setAttribute("disabled", "true");
    elements.saveBtn?.setAttribute("disabled", "true");
    elements.testRecipient?.setAttribute("disabled", "true");
    elements.testSubject?.setAttribute("disabled", "true");
    elements.testMessage?.setAttribute("disabled", "true");
    elements.sendTestBtn?.setAttribute("disabled", "true");
  }
}

function start() {
  // Initialize header first and wait for it
  initSubscriberHeader().then(() => {
    initUiHandlers();

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "./subscriber-login.html";
        return;
      }
      try {
        await bootstrap(user);
        // Update header after bootstrap
        const companyName = state.userProfile?.companyName || state.userProfile?.name || 'My Business';
        setCompanyName(companyName);
        setActiveTab('settings');
      } catch (error) {
        console.error("Email settings bootstrap failed", error);
        alert(error?.message || "Unable to load email settings");
        await signOut(auth);
        window.location.href = "./subscriber-login.html";
      }
    });
  });
}

start();
