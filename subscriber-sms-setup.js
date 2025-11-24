import { app, auth, db } from "./public/firebase-init.js";
import { initSubscriberHeader, setCompanyName, setActiveTab } from "./public/header-template.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  addDoc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  limit,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";
import { tenantCollection, tenantDoc } from "./lib/subscriber-paths.js";

const PACKAGES = [
  { id: "sms-500", credits: 500, priceGBP: 25, description: "500 SMS credits" },
  { id: "sms-1000", credits: 1000, priceGBP: 50, description: "1000 SMS credits" },
  { id: "sms-2500", credits: 2500, priceGBP: 125, description: "2500 SMS credits" },
  { id: "sms-5000", credits: 5000, priceGBP: 250, description: "5000 SMS credits" },
];

const state = {
  subscriberId: null,
  subscriberProfile: null,
  viewerProfile: null,
  viewerRole: null,
  settings: null,
  purchases: [],
  pendingPurchase: false,
  savingSender: false,
};

const elements = {
  authOverlay: document.getElementById("authOverlay"),
  smsContent: document.getElementById("smsContent"),
  logoutBtn: document.getElementById("logoutBtn"),
  menuBtn: document.getElementById("menuBtn"),
  packagesContainer: document.getElementById("packagesContainer"),
  historyContainer: document.getElementById("historyContainer"),
  purchaseFeedback: document.getElementById("purchaseFeedback"),
  senderForm: document.getElementById("senderForm"),
  senderName: document.getElementById("senderName"),
  saveSenderBtn: document.getElementById("saveSenderBtn"),
  senderStatus: document.getElementById("senderStatus"),
  creditsBalance: document.getElementById("creditsBalance"),
  lastTopUp: document.getElementById("lastTopUp"),
};

const VERCEL_FALLBACK_ORIGIN = "https://hooks.swashcleaning.co.uk";
const PENDING_FLOW_STORAGE_KEY = "smsPendingFlow";

async function fetchWithFallback(path, options = {}) {
  console.info("[SMS Centre] Requesting", path, options?.method || "GET");
  try {
    const primary = await fetch(path, options);
    if (primary.status !== 404) {
      console.info("[SMS Centre] Primary response", path, primary.status);
      return primary;
    }
    console.info("[SMS Centre] Primary returned 404, switching to fallback", path);
  } catch (error) {
    console.warn("[SMS Centre] Primary fetch failed, trying fallback", path, error);
  }

  try {
    const fallback = await fetch(`${VERCEL_FALLBACK_ORIGIN}${path}`, options);
    console.info("[SMS Centre] Fallback response", `${VERCEL_FALLBACK_ORIGIN}${path}`, fallback.status);
    return fallback;
  } catch (error) {
    console.warn("[SMS Centre] Fallback fetch failed", path, error);
    throw error;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { hour12: false });
  } catch (_) {
    return "—";
  }
}

function renderPackages() {
  if (!elements.packagesContainer) return;
  const cards = PACKAGES.map((pkg) => {
    const price = formatCurrency(pkg.priceGBP);
    return `
      <div class="package-card">
        <div>
          <div style="font-size:1.2rem;font-weight:700;color:#1e293b;">${pkg.credits.toLocaleString()} credits</div>
          <div class="package-meta">${price} • ${pkg.description}</div>
        </div>
        <button type="button" class="btn btn-primary" data-package-id="${pkg.id}">Buy now</button>
        <p style="margin:0;font-size:0.8rem;color:#64748b;">Link opens a secure GoCardless Instant Bank Pay checkout.</p>
      </div>
    `;
  }).join("");
  elements.packagesContainer.innerHTML = cards;
}

function renderHistory() {
  if (!elements.historyContainer) return;
  if (!state.purchases.length) {
    elements.historyContainer.innerHTML = '<div class="history-item"><strong>No purchases yet</strong><span>Top-ups will appear here once created.</span></div>';
    return;
  }
  const items = state.purchases.map((purchase) => {
    const status = (purchase.status || "pending").toLowerCase();
    const statusLabel = status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Pending";
    const created = formatTimestamp(purchase.createdAt);
    const completed = purchase.completedAt ? formatTimestamp(purchase.completedAt) : null;
    const credits = Number(purchase.credits) || 0;
    const amount = Number(purchase.amountGBP) || 0;
    const ref = purchase.billingRequestId ? `<span style="font-size:0.8rem;color:#64748b;">Ref: ${purchase.billingRequestId}</span>` : "";
    const completedLine = completed ? `<span style="font-size:0.85rem;color:#16a34a;">Confirmed: ${completed}</span>` : "";
    return `
      <div class="history-item">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <strong>${credits.toLocaleString()} credits • ${formatCurrency(amount)}</strong>
          <span class="history-status" data-status="${status}">${statusLabel}</span>
        </div>
        <span style="font-size:0.85rem;color:#475569;">Created: ${created}</span>
        ${completedLine}
        ${ref}
      </div>
    `;
  }).join("");
  elements.historyContainer.innerHTML = items;
}

function updateBalanceDisplay() {
  const balance = Number(state.settings?.creditsBalance) || 0;
  if (elements.creditsBalance) {
    elements.creditsBalance.textContent = balance.toLocaleString();
  }
  if (elements.lastTopUp) {
    const ts = state.settings?.lastTopUpAt || state.settings?.updatedAt;
    elements.lastTopUp.textContent = `Last top-up: ${formatTimestamp(ts)}`;
  }
  if (elements.senderName) {
    elements.senderName.value = (state.settings?.senderName || "").toUpperCase();
  }
}

function setSenderStatus(message, isError = false) {
  if (!elements.senderStatus) return;
  elements.senderStatus.textContent = message;
  elements.senderStatus.style.color = isError ? "#991b1b" : "#64748b";
}

function setPurchaseFeedback(message, type = "notice") {
  if (!elements.purchaseFeedback) return;
  if (!message) {
    elements.purchaseFeedback.innerHTML = "";
    return;
  }
  const className = type === "error" ? "error" : "notice";
  elements.purchaseFeedback.innerHTML = `<div class="${className}">${message}</div>`;
}

async function handleReturnFromCheckout() {
  try {
    console.info("[SMS Centre] Landing after checkout", window.location.href);

    const params = new URLSearchParams(window.location.search);
    const rawHash = window.location.hash && window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;

    if (rawHash && rawHash.includes("=")) {
      try {
        const hashParams = new URLSearchParams(rawHash);
        for (const [key, value] of hashParams.entries()) {
          if (!params.has(key)) {
            params.set(key, value);
          }
        }
      } catch (hashError) {
        console.warn("[SMS Centre] Unable to parse hash parameters", rawHash, hashError);
      }
    }

    let billingRequestId = params.get("billing_request_id");
    let redirectFlowId = params.get("redirect_flow_id");

    let storedFlow = null;
    try {
      const rawStored = window.localStorage.getItem(PENDING_FLOW_STORAGE_KEY);
      storedFlow = rawStored ? JSON.parse(rawStored) : null;
    } catch (storageError) {
      console.warn("[SMS Centre] Unable to read pending flow from storage", storageError);
    }

    if (!billingRequestId && storedFlow?.billingRequestId) billingRequestId = storedFlow.billingRequestId;
    if (!redirectFlowId && storedFlow?.redirectFlowId) redirectFlowId = storedFlow.redirectFlowId;

    const cameBack = Boolean(billingRequestId || redirectFlowId || storedFlow);
    if (!cameBack) return;

    setPurchaseFeedback("Thanks for completing the checkout. Credits update automatically once GoCardless confirms the payment.");

    if (redirectFlowId) {
      console.info("[SMS Centre] Completing GoCardless flow", { redirectFlowId, billingRequestId });
      try {
        const response = await fetchWithFallback("/api/completeInstantPayFlow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redirectFlowId,
            billingRequestId: billingRequestId || storedFlow?.billingRequestId || null,
            subscriberId: state.subscriberId || storedFlow?.subscriberId || null,
            sandboxForce: true,
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          console.warn("[SMS Centre] Flow completion failed", error);
          setPurchaseFeedback(error?.error || "Checkout completed in GoCardless. Waiting for confirmation…");
        } else {
          const result = await response.json().catch(() => ({}));
          console.info("[SMS Centre] Flow completion success", result);
          if (result?.billing_request_id && billingRequestId && result.billing_request_id !== billingRequestId) {
            console.warn("[SMS Centre] Billing request mismatch after flow completion", result);
          }
          if (billingRequestId && state.subscriberId) {
            try {
              const purchasesRef = tenantCollection(db, state.subscriberId, "smsPurchases");
              const match = query(purchasesRef, where("billingRequestId", "==", billingRequestId), limit(1));
              const snap = await getDocs(match);
              if (!snap.empty) {
                const existingDoc = snap.docs[0];
                const existingData = existingDoc.data() || {};
                await setDoc(existingDoc.ref, {
                  redirectFlowId,
                  status: existingData.status || "pending",
                  updatedAt: serverTimestamp(),
                }, { merge: true });
              }
            } catch (storeError) {
              console.warn("[SMS Centre] Failed to tag redirect flow on purchase", storeError);
            }
          }

          if (result?.sandboxApplied) {
            setPurchaseFeedback("Payment confirmed. Credits applied immediately (sandbox mode).");
          }
        }
      } catch (flowError) {
        console.warn("[SMS Centre] Error completing GoCardless redirect flow", flowError);
        setPurchaseFeedback("Checkout completed. Awaiting payment confirmation…");
      }
    }

    if (storedFlow) {
      try {
        window.localStorage.removeItem(PENDING_FLOW_STORAGE_KEY);
      } catch (clearError) {
        console.warn("[SMS Centre] Unable to clear pending flow storage", clearError);
      }
    }

    params.delete("billing_request_id");
    params.delete("redirect_flow_id");
    const remaining = params.toString();
    const queryPart = remaining ? `?${remaining}` : "";
    const hashPart = rawHash && rawHash.includes("=") ? "" : window.location.hash || "";
    const newUrl = `${window.location.pathname}${queryPart}${hashPart}`;
    window.history.replaceState({}, document.title, newUrl);
  } catch (error) {
    console.warn("Unable to process GoCardless return parameters", error);
  }
}

function canManageSettings() {
  if (state.viewerRole === "admin") return true;
  if (state.viewerRole === "subscriber" && state.viewerProfile?.id === state.subscriberId) return true;
  return false;
}

async function loadSettings() {
  if (!state.subscriberId) return;
  try {
    const ref = tenantDoc(db, state.subscriberId, "private", "smsSettings");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      state.settings = snap.data() || {};
    } else {
      state.settings = { creditsBalance: 0 };
      if (canManageSettings()) {
        await setDoc(ref, { creditsBalance: 0, createdAt: serverTimestamp() }, { merge: true });
      }
    }
    updateBalanceDisplay();
  } catch (error) {
    console.error("Failed to load SMS settings", error);
    setPurchaseFeedback("Unable to load SMS settings. Please refresh.", "error");
  }
}

async function loadPurchases() {
  if (!state.subscriberId) return;
  try {
    const purchasesRef = tenantCollection(db, state.subscriberId, "smsPurchases");
    const q = query(purchasesRef, orderBy("createdAt", "desc"), limit(15));
    const snap = await getDocs(q);
    state.purchases = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderHistory();
  } catch (error) {
    console.error("Failed to load SMS purchases", error);
  }
}

function validateSenderName(value) {
  if (!value) throw new Error("Enter a sender name");
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length < 3 || trimmed.length > 11) {
    throw new Error("Sender name must be 3-11 characters");
  }
  if (!/^[A-Z0-9]+$/.test(trimmed)) {
    throw new Error("Only letters and numbers are allowed");
  }
  return trimmed;
}

async function handleSenderSubmit(event) {
  event.preventDefault();
  if (state.savingSender || !state.subscriberId) return;
  if (!canManageSettings()) {
    setSenderStatus("Only the subscriber owner can edit the sender name.", true);
    return;
  }
  try {
    const desired = validateSenderName(elements.senderName.value);
    state.savingSender = true;
    elements.saveSenderBtn.disabled = true;
    setSenderStatus("Saving sender name...");

    const ref = tenantDoc(db, state.subscriberId, "private", "smsSettings");
    await setDoc(ref, {
      senderName: desired,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    if (!state.settings) state.settings = {};
    state.settings.senderName = desired;
    setSenderStatus("Sender name saved");
  } catch (error) {
    console.error("Failed to save sender name", error);
    const message = error?.message || "Unable to save sender name";
    setSenderStatus(message, true);
  } finally {
    elements.saveSenderBtn.disabled = false;
    state.savingSender = false;
  }
}

function getPackage(packageId) {
  return PACKAGES.find((pkg) => pkg.id === packageId) || null;
}

async function startPurchase(packageId) {
  if (state.pendingPurchase || !state.subscriberId) return;
  if (!canManageSettings()) {
    setPurchaseFeedback("Only the subscriber owner can top up SMS credits.", "error");
    return;
  }
  const pkg = getPackage(packageId);
  if (!pkg) return;

  try {
    state.pendingPurchase = true;
    setPurchaseFeedback(`Creating payment link for ${pkg.credits.toLocaleString()} credits...`);

    const response = await fetchWithFallback("/api/createInstantPayLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(pkg.priceGBP * 100),
        currency: "GBP",
        description: `${pkg.credits} SMS credits for ${state.subscriberProfile?.companyName || "Swash subscriber"}`,
        customerName: state.subscriberProfile?.companyName || state.subscriberProfile?.name || "Subscriber",
        credits: pkg.credits,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Payment link creation failed");
    }

    const data = await response.json();
    if (!data.redirect_url || !data.session_id) {
      throw new Error("Payment link missing redirect URL");
    }

    const redirectFlowId = data.redirect_flow_id || null;

    try {
      window.localStorage.setItem(PENDING_FLOW_STORAGE_KEY, JSON.stringify({
        subscriberId: state.subscriberId,
        billingRequestId: data.session_id,
        redirectFlowId,
        credits: pkg.credits,
        createdAt: Date.now(),
      }));
    } catch (storageError) {
      console.warn("[SMS Centre] Unable to persist pending flow locally", storageError);
    }

    const purchasesRef = tenantCollection(db, state.subscriberId, "smsPurchases");
    await addDoc(purchasesRef, {
      packageId: pkg.id,
      credits: pkg.credits,
      amountGBP: pkg.priceGBP,
      billingRequestId: data.session_id,
      redirectFlowId,
      redirectUrl: data.redirect_url,
      status: "pending",
      createdAt: serverTimestamp(),
      createdBy: {
        uid: state.viewerProfile?.id || state.viewerProfile?.uid || auth.currentUser?.uid || null,
        email: state.viewerProfile?.email || auth.currentUser?.email || null,
      },
    });

    await loadPurchases();

    setPurchaseFeedback("Redirecting to secure GoCardless checkout...");
    window.location.href = data.redirect_url;
  } catch (error) {
    console.error("Failed to start SMS purchase", error);
    setPurchaseFeedback(error?.message || "Unable to create payment link", "error");
  } finally {
    state.pendingPurchase = false;
  }
}

function attachEventHandlers() {
  elements.logoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "./subscriber-login.html";
  });

  elements.menuBtn?.addEventListener("click", () => {
    window.location.href = "/main.html";
  });

  elements.senderForm?.addEventListener("submit", handleSenderSubmit);

  elements.packagesContainer?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-package-id]");
    if (!button) return;
    const packageId = button.getAttribute("data-package-id");
    startPurchase(packageId);
  });
}

async function bootstrap(user) {
  const access = await ensureSubscriberAccess(user);
  state.viewerProfile = access.viewerProfile;
  state.viewerRole = access.viewerRole;
  state.subscriberId = access.subscriberId;
  state.subscriberProfile = access.subscriberProfile;

  if (access.viewerRole === "subscriber" && !access.viewerProfile.billingCompleted) {
    window.location.href = "./subscriber-billing.html";
    return;
  }

  if (elements.authOverlay) {
    elements.authOverlay.style.display = "none";
  }
  if (elements.smsContent) {
    elements.smsContent.style.display = "block";
  }

  await handleReturnFromCheckout();
  renderPackages();
  await loadSettings();
  await loadPurchases();

  if (!canManageSettings()) {
    setSenderStatus("Only the account owner can change the sender name.");
    elements.senderName?.setAttribute("disabled", "true");
    elements.saveSenderBtn?.setAttribute("disabled", "true");
  }
}

function init() {
  // Initialize header first and wait for it
  initSubscriberHeader().then(() => {
    attachEventHandlers();

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "./subscriber-login.html";
        return;
      }
      try {
        await bootstrap(user);
        // Update header after bootstrap
        const companyName = state.subscriberProfile?.companyName || state.subscriberProfile?.name || 'My Business';
        setCompanyName(companyName);
        setActiveTab('sms');
      } catch (error) {
        console.error("SMS centre bootstrap failed", error);
        alert(error?.message || "Unable to load SMS centre");
        await signOut(auth);
        window.location.href = "./subscriber-login.html";
      }
    });
  });
}

init();
