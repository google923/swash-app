// Swash Quote Calculator
// Handles quote calculations, Firestore persistence, EmailJS notifications, and offline queuing.

console.log("[Quote DEBUG] script.js module loading...");

import initMenuDropdown from "./assets/rep/menu.js";
import { authStateReady, handlePageRouting } from "../auth-check.js";
console.log("[Quote DEBUG] menu.js imported successfully");
import {
  queueOfflineSubmission,
  syncQueue,
  getQueue,
  removeFromQueue,
} from "./offline-queue.js";
console.log("[Quote DEBUG] offline-queue.js imported successfully");
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

// ✅ DETECT EMBED MODE FIRST (before using it)
var params = new URLSearchParams(window.location.search);
var isEmbedMode = params.get("embed") === "true" || window.self !== window.top;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

await waitForDomReady();
await authStateReady();
console.log("[Page] Auth ready, userRole:", window.userRole);

if (!isEmbedMode) {
  const routing = await handlePageRouting("shared");
  if (routing.redirected) {
    console.log("[Quote] Redirect scheduled; halting calculator bootstrap");
    return;
  }
}

await delay(100);

// Prefill rep code for authenticated users (internal quote form)
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const repInput = document.getElementById("repCode");
    if (!repInput) return;

    let repName = "";
    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const userData = snap.data();
        repName = userData?.repName || userData?.name || "";
      }
    } catch (innerErr) {
      console.warn("[Quote] Could not load users doc for repName:", innerErr);
    }

    if (!repName) {
      repName = (user.displayName || (user.email?.split("@")[0] || "")).toString().trim().toUpperCase();
    }

    if (repName) {
      repInput.value = repName;
      repInput.readOnly = true;
      repInput.setAttribute("readonly", "");
      console.log("[Quote] Rep code prefilled with:", repName);
    }
  } catch (err) {
    console.warn("[Quote] Failed to prefill rep code:", err);
  }
});

const selectors = {
  repCode: document.getElementById("repCode"),
  quoteDate: document.getElementById("quoteDate"),
  serviceTier: document.getElementById("serviceTier"),
  tierDescription: document.getElementById("tierDescription"),
  houseType: document.getElementById("houseType"),
  houseSize: document.getElementById("houseSize"),
  conservatory: document.getElementById("conservatory"),
  extension: document.getElementById("extension"),
  roofLanterns: document.getElementById("roofLanterns"),
  roofLanternsValue: document.getElementById("roofLanternsValue"),
  skylights: document.getElementById("skylights"),
  skylightsValue: document.getElementById("skylightsValue"),
  partialCleaning: document.getElementById("partialCleaning"),
  alternating: document.getElementById("alternating"),
  addVAT: document.getElementById("addVAT"),
  notes: document.getElementById("notes"),
  calculateBtn: document.getElementById("calculateBtn"),
  submitBtn: document.getElementById("submitBtn"),
  resultPanel: document.getElementById("result"),
  customerSection: document.getElementById("customerFields"),
  customerName: document.getElementById("customerName"),
  address: document.getElementById("address"),
  mobile: document.getElementById("mobile"),
  email: document.getElementById("email"),
  paymentRefBox: document.getElementById("paymentRefBox"),
  paymentRefValue: document.getElementById("paymentRefValue"),
  emailPreviewCard: document.getElementById("emailPreviewCard"),
  emailPreviewSubject: document.getElementById("emailPreviewSubject"),
  emailPreviewBody: document.getElementById("emailPreviewBody"),
  queueAlerts: document.getElementById("queueAlerts"),
  applyOfferBtn: document.getElementById("applyOfferBtn"),
  emailMessage: document.getElementById("emailMessage"),
};

console.log("[Quote DEBUG] Selectors initialized. Checking key elements:", {
  repCode: !!selectors.repCode,
  quoteDate: !!selectors.quoteDate,
  calculateBtn: !!selectors.calculateBtn,
  submitBtn: !!selectors.submitBtn,
});

if (selectors.repCode) {
  selectors.repCode.setAttribute("autocomplete", "off");
  selectors.repCode.setAttribute("autocorrect", "off");
  selectors.repCode.setAttribute("autocapitalize", "off");
  selectors.repCode.setAttribute("spellcheck", "false");
  selectors.repCode.setAttribute("inputmode", "text");
  selectors.repCode.dataset.lpignore = "true";
}

if (selectors.email) {
  selectors.email.setAttribute("autocomplete", "email");
  selectors.email.setAttribute("inputmode", "email");
  selectors.email.setAttribute("spellcheck", "false");
}

// Set quote date to today immediately
if (selectors.quoteDate) {
  const today = new Date();
  selectors.quoteDate.value = today.toLocaleDateString("en-GB");
}

// --- PRICING CONSTANTS & TABLES (Wix logic) ---
const MIN_NET_PRICE = 16.0;
const GOLD_FACTOR = 1.35;
const ROOF_LANTERN_ADDON = 10.0;
const VELUX_ADDON_EACH = 1.5;

const priceTableBase = {
  "2 bed": { "semi": { silver:{ base:16, ext:20, cons:23, both:26 } }, "detached": { silver:{ base:19, ext:23, cons:26, both:29 } } },
  "3 bed": { "semi": { silver:{ base:21, ext:25, cons:28, both:31 } }, "detached": { silver:{ base:24, ext:28, cons:31, both:34 } } },
  "4 bed": { "semi": { silver:{ base:26, ext:30, cons:33, both:36 } }, "detached": { silver:{ base:29, ext:33, cons:36, both:39 } } },
  "5 bed": { "semi": { silver:{ base:31, ext:35, cons:38, both:41 } }, "detached": { silver:{ base:34, ext:38, cons:41, both:44 } } },
  "6 bed": { "semi": { silver:{ base:36, ext:40, cons:43, both:46 } }, "detached": { silver:{ base:39, ext:43, cons:46, both:49 } } }
};

// Robust normalization for house type dropdown values
const HOUSE_TYPE_BAND_MAP = {
  "semi":"semi","semi-detached":"semi","terrace":"semi","terraced":"semi",
  "maisonette":"semi","bungalow":"semi",
  "detached":"detached","caravan":"detached","mobile home":"detached","house":"detached"
};
const HOUSE_TYPE_MULT = {
  "caravan":0.90,"mobile home":0.90,"bungalow":0.90,"maisonette":0.94,
  "terrace":0.97,"terraced":0.97,"semi":1.00,"semi-detached":1.00,"detached":1.05,"house":1.05
};

function normalizeSize(s){
  const v = String(s).toLowerCase();
  if (v.includes('1') && v.includes('bed')) return '2 bed';
  if (v.includes('2') && v.includes('bed')) return '2 bed';
  if (v.includes('3') && v.includes('bed')) return '3 bed';
  if (v.includes('4') && v.includes('bed')) return '4 bed';
  if (v.includes('5') && v.includes('bed')) return '5 bed';
  if (v.includes('6') && v.includes('bed')) return '6 bed';
  return '2 bed';
}

function normalizeHouseTypeKey(s) {
  // Accepts dropdown value or label, returns mapped key
  const v = String(s).toLowerCase().replace(/\s+/g,' ').trim();
  if (v.includes('bungalow')) return 'bungalow';
  if (v.includes('mobile')) return 'caravan'; // treat 'Mobile Home' as 'caravan' for multiplier
  if (v.includes('caravan')) return 'caravan';
  if (v.includes('maisonette')) return 'maisonette';
  if (v.includes('terrace')) return 'terrace';
  if (v.includes('semi')) return 'semi';
  if (v.includes('detached')) return 'detached';
  if (v.includes('house')) return 'house';
  return 'semi';
}

function getBandAndMult(houseType) {
  const key = normalizeHouseTypeKey(houseType);
  return {
    band: HOUSE_TYPE_BAND_MAP[key] || 'semi',
    mult: HOUSE_TYPE_MULT[key] ?? 1.00
  };
}

function calculatePricing() {
  // --- Wix logic pricing (with partial cleaning retained, no VAT multiplier) ---
  const tierValue = selectors.serviceTier.value;
  const isGold = tierValue === "gold";
  const houseTypeRaw = selectors.houseType.value || "semi";
  const houseSizeRaw = selectors.houseSize.value || "2 bed";
  const sizeKey = normalizeSize(houseSizeRaw);
  const { band, mult } = getBandAndMult(houseTypeRaw);

  // Get base row
  const row = priceTableBase[sizeKey]?.[band]?.silver;
  let price = row ? row.base : MIN_NET_PRICE;

  // Conservatory / Extension logic
  const hasExt = selectors.extension.checked;
  const hasCons = selectors.conservatory.checked;
  if (hasExt && hasCons) price = row ? row.both : price;
  else if (hasExt) price = row ? row.ext : price;
  else if (hasCons) price = row ? row.cons : price;

  // Apply house type multiplier
  price *= mult;

  // Add roof lanterns & skylights
  const lanterns = clamp(Number(selectors.roofLanterns.value) || 0, 0, 50);
  const skylights = clamp(Number(selectors.skylights.value) || 0, 0, 50);
  price += ROOF_LANTERN_ADDON * lanterns;
  price += VELUX_ADDON_EACH * skylights;

  // Alternating logic
  if (selectors.alternating.checked) {
    price /= 2;
    if (price < MIN_NET_PRICE) price = MIN_NET_PRICE;
  }

  // Gold tier logic
  if (isGold) price *= GOLD_FACTOR;

  // Minimum price enforcement
  if (price < MIN_NET_PRICE) price = MIN_NET_PRICE;

  // Partial cleaning percentage (rep can reduce by % if windows inaccessible)
  const partialPercentage = clamp(Number(selectors.partialCleaning.value) || 100, 0, 100);
  price *= (partialPercentage / 100);

  // Final rounding & return
  price = Math.max(price, MIN_NET_PRICE);

  return {
    pricePerClean: Number(price.toFixed(2)),
    priceUpfront: Number((price * 3).toFixed(2)),
  };
}
  const pricePer = formatCurrency(quote.pricePerClean);

  let offerLine = "";
  if (offerApplied && quote.tier === "gold") {
    const expires = offerExpiresAt ? new Date(offerExpiresAt) : null;
    const expiryStr = expires ? expires.toLocaleDateString("en-GB") : "soon";
    offerLine = `\n\nGet the next bit done quickly — this offer expires on ${expiryStr}!`;
  }

  return (
    `Hi ${quote.customerName}, your ${quote.houseSize} ${quote.houseType}` +
    `${extrasLabel && extrasLabel !== "Standard clean" ? ` with ${extrasLabel}` : ""}` +
    ` will all be kept clean soon at ${quote.address}.` +
    `\n\nYou are on our ${planLabel} plan${offerApplied && quote.tier === "gold" ? " (special offer applied)" : ""}, and the price per clean every 4 weeks is ${pricePer}.` +
    offerLine +
    `\n\nWe collect payment for regular window cleaning services 3 months in advance so we can focus on doing a great job with less time messing around with payments.` +
    `\n\nUse the details below to make a bank transfer using this reference code: ${quote.refCode}` +
    `\n\nBusiness Acc Name: SWASH CLEANING LTD` +
    `\nAccount Number: 65069359` +
    `\nSort Code: 23-01-20` +
    `\n\nAmount: ${formatCurrency(quote.price)} ` +
    `\n\nWhen this is done we'll book you in for when we are next in your area on our 4 weekly round.`
  );
}

function computeOfferExpiryIso() {
  // End of day, 3 days from now (local time)
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + 3);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function formatCurrency(value) {
  return `\u00A3${Number(value || 0).toFixed(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function generateReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let i = 0; i < 6; i += 1) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildExtrasLabel(quote) {
  const parts = [];
  if (quote.conservatory) parts.push("Conservatory");
  if (quote.extension) parts.push("Extension");
  if (quote.roofLanterns) {
    const plural = quote.roofLanterns === 1 ? "roof lantern" : "roof lanterns";
    parts.push(`${quote.roofLanterns} ${plural}`);
  }
  if (quote.skylights) {
    const plural = quote.skylights === 1 ? "skylight" : "skylights";
    parts.push(`${quote.skylights} ${plural}`);
  }
  return parts.length ? parts.join(", ") : "Standard clean";
}

// ...existing code...
  const tierValue = selectors.serviceTier?.value || "";
  let offerHtml = "";
  if (offerApplied && tierValue === "gold") {
    const expires = offerExpiresAt ? new Date(offerExpiresAt) : null;
    const expiryLabel = expires
      ? expires.toLocaleDateString("en-GB")
      : "tomorrow";
    offerHtml = `<p class="status info">Special offer applied: Gold for Silver pricing until ${escapeHtml(expiryLabel)}.</p>`;
  }
  selectors.resultPanel.innerHTML = `
    <p><strong>Price per clean:</strong> ${formatCurrency(pricing.pricePerClean)}</p>
    ${offerHtml}
  `;
  selectors.resultPanel.hidden = false;
  if (selectors.customerSection) {
    selectors.customerSection.hidden = false;
  }
  // Do not render preview here; it will be shown after submission only
}

function updateTierCopy() {
  const tierKey = selectors.serviceTier.value === "gold-for-silver" ? "gold-for-silver" : selectors.serviceTier.value;
  const copy = tierDetails[tierKey] || "";
  selectors.tierDescription.textContent = copy;
}

async function sendQuoteEmail(
  quote,
  { statusPanel = selectors.resultPanel, silent = false } = {},
) {
  if (!window.emailjs || !emailjs.send) return true;

  const recipient = normaliseEmail(quote.email);
  if (!recipient) {
    if (!silent && statusPanel) {
      statusPanel.insertAdjacentHTML(
        "beforeend",
        '<p class="status warning">Email notification skipped: no valid customer email address was supplied.</p>',
      );
    }
    return false;
  }

  try {
    console.debug?.("[Swash] Sending quote email to", recipient);
    const message = selectors.emailMessage?.value?.trim() || buildEmailMessage(quote);
    await emailjs.send("service_cdy739m", "template_6mpufs4", {
      customer_name: quote.customerName,
      title: "Your Swash Window Cleaning Quote",
      message,
      message_body: message,
      email: recipient,
    });
    return true;
  } catch (error) {
    console.warn("EmailJS send failed", error);
    if (!silent && statusPanel) {
      const status = error?.status ? `status ${error.status}` : "unknown error";
      const message = error?.text || error?.message || "No additional details";
      statusPanel.insertAdjacentHTML(
        "beforeend",
        `<p class="status warning">Email notification could not be sent (${status}). Details: ${escapeHtml(message)}. The quote was still generated.</p>`,
      );
    }
    return false;
  }
}

function renderEmailPreview(quote) {
  if (!selectors.emailPreviewCard || !selectors.emailPreviewBody) return;

  const subject = "Your Swash Window Cleaning Quote";
  selectors.emailPreviewSubject.textContent = subject;

  const msg = (selectors.emailMessage?.value?.trim()) || buildEmailMessage(quote);
  const paragraphs = msg.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join("");

  const html = `
    <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #ddd; border-radius: 12px; padding: 20px; line-height: 1.55;">
      ${paragraphs}
    </div>
  `;

  selectors.emailPreviewBody.innerHTML = html;
  selectors.emailPreviewCard.hidden = false;
}

function renderOfflineQueue() {
  if (!selectors.queueAlerts) return;
  const queue = getQueue();
  if (!queue.length) {
    selectors.queueAlerts.innerHTML = "";
    selectors.queueAlerts.hidden = true;
    return;
  }

  selectors.queueAlerts.innerHTML = queue
    .map((quote) => {
      const name =
        quote.customerName || quote.address || `Ref ${quote.refCode}`;
      return `
        <div class="queue-item">
          <span class="queue-item__text">Quote for ${escapeHtml(
            name,
          )} is waiting to sync and email.</span>
          <button type="button" class="btn btn-secondary queue-send" data-ref="${escapeHtml(
            quote.refCode,
          )}">Send now</button>
        </div>
      `;
    })
    .join("");
  selectors.queueAlerts.hidden = false;
}

async function handleSendQueuedQuote(refCode) {
  const queue = getQueue();
  const quote = queue.find((item) => item.refCode === refCode);
  if (!quote) return;

  if (!navigator.onLine) {
    alert("You are still offline. Connect to the internet before sending queued quotes.");
    return;
  }

  const { emailPending, queuedAt, ...payload } = quote;
  const storedOnline = await persistQuote(payload);
  if (!storedOnline) {
    alert("Quote could not be saved to the dashboard yet. Please try again shortly.");
    return;
  }

  const emailSent = await sendQuoteEmail(payload, { silent: true });
  if (!emailSent) {
    alert("Quote saved to the dashboard, but the email could not be sent. Please retry later.");
    return;
  }

  removeFromQueue(refCode);
  renderOfflineQueue();
  selectors.resultPanel?.insertAdjacentHTML(
    "beforeend",
    `<p class="status success">Queued quote for ${escapeHtml(
      quote.customerName || quote.refCode,
    )} has been sent.</p>`,
  );
}

window.addEventListener("swashQueueUpdated", () => {
  renderOfflineQueue();
});

window.addEventListener("swashQueueSynced", async (event) => {
  const quote = event.detail?.quote;
  if (!quote || !navigator.onLine) return;
  const sent = await sendQuoteEmail(quote, { silent: true });
  if (!sent) {
    console.warn("Queued quote synced but email send failed", quote.refCode || quote.customerName);
  } else {
    console.info("Queued quote email sent", quote.refCode || quote.customerName);
  }
});

async function persistQuote(quote) {
  try {
    await addDoc(collection(db, "quotes"), {
      ...quote,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error("Firestore write failed", error);
    // Only return false if it's a network error, not auth or permissions
    if (error.code === 'unavailable' || error.code === 'failed-precondition') {
      console.warn("Network unavailable, queuing offline");
      return false;
    }
    // For other errors (permissions, etc), still consider it "online" but failed
    throw error;
  }
}

function validateCustomerFields() {
  if (selectors.repCode && !selectors.repCode.value.trim()) {
    selectors.repCode.value = "Website Quote";
  }

  const required = [selectors.customerName, selectors.address, selectors.mobile, selectors.email];

  for (const input of required) {
    if (!input?.value.trim()) {
      input?.focus();
      input?.reportValidity?.();
      return false;
    }
  }

  const normalised = normaliseEmail(selectors.email.value);
  if (!normalised) {
    selectors.email.setCustomValidity("Please enter a valid email address.");
    selectors.email.reportValidity?.();
    selectors.email.setCustomValidity("");
    return false;
  }
  return true;
}

async function handleSubmit() {
  console.log("[Quote] Submit handler triggered");
  // Require authentication to submit online
  try {
    if (!auth.currentUser) {
      const overlay = document.getElementById("authOverlay");
      if (overlay) {
        overlay.hidden = false;
        overlay.style.display = "flex";
      }
      selectors.resultPanel?.insertAdjacentHTML(
        "beforeend",
        '<p class="status warning">Please sign in first to save the quote online and send the email.</p>',
      );
      return;
    }
  } catch (_) {
    // ignore
  }
  
  if (!validateCustomerFields()) {
    console.warn("[Quote] Customer field validation failed");
    return;
  }

  const pricing = latestPricing || calculatePricing();
  if (!latestPricing) {
    renderPricing(pricing);
  }
  selectors.resultPanel
    .querySelectorAll(".status")
    .forEach((node) => node.remove());

  let repCodeValue = selectors.repCode.value.trim();
  if (!repCodeValue) {
    repCodeValue = "Website Quote";
    selectors.repCode.value = repCodeValue;
  }

  const emailValue = normaliseEmail(selectors.email.value);
  if (!emailValue) {
    selectors.email.focus();
    selectors.resultPanel?.insertAdjacentHTML(
      "beforeend",
      '<p class="status warning">Please enter a valid email address to receive your quote.</p>',
    );
    return;
  }
  selectors.email.value = emailValue;

  const quote = {
    repCode: repCodeValue.toUpperCase(),
    date: new Date().toISOString(),
    customerName: selectors.customerName.value.trim(),
    address: selectors.address.value.trim(),
    mobile: selectors.mobile.value.trim(),
    email: emailValue,
    tier: selectors.serviceTier.value,
    houseType: selectors.houseType.value,
    houseSize: selectors.houseSize.value,
    extension: selectors.extension.checked,
    conservatory: selectors.conservatory.checked,
    skylights: Number(selectors.skylights.value || 0),
    roofLanterns: Number(selectors.roofLanterns.value || 0),
    partialCleaning: Number(selectors.partialCleaning.value || 100),
    alternating: selectors.alternating.checked,
    pricePerClean: pricing.pricePerClean,
    price: pricing.priceUpfront,
    refCode: generateReference(),
    status: "Pending Payment",
    notes: selectors.notes.value.trim(),
    // Offer metadata (for admin auto-revert)
    offerApplied: !!offerApplied,
    offerType: offerApplied ? "gold-for-silver" : null,
    offerExpiresAt: offerApplied && offerExpiresAt ? offerExpiresAt : null,
  };

  console.log("[Quote] Quote object created:", quote);

  // Generate and store the email message now for preview and sending
  if (selectors.emailMessage) {
    selectors.emailMessage.value = buildEmailMessage(quote);
  }

  let storedOnline = false;
  let persistError = null;
  try {
    // Always try to persist, don't trust navigator.onLine on mobile
    storedOnline = await persistQuote(quote);
    console.log("[Quote] Firestore persist result:", storedOnline);
  } catch (error) {
    console.error("[Quote] Failed to save quote to Firestore:", error);
    persistError = error;
    storedOnline = false;
  }
  
  if (!storedOnline) {
    if (persistError) {
      const code = persistError?.code || "unknown";
      console.warn("[Quote] Persist error code:", code);
      // Do not queue for permission/auth errors; show a clear message instead
      if (code === "permission-denied" || code === "unauthenticated") {
        selectors.resultPanel?.insertAdjacentHTML(
          "beforeend",
          `<p class="status warning">You do not have permission to save quotes (error: ${escapeHtml(code)}). Please sign in with a rep account or contact an admin.</p>`,
        );
        return;
      }
      // For other errors, show generic message
      selectors.resultPanel?.insertAdjacentHTML(
        "beforeend",
        `<p class="status warning">We could not save the quote right now (error: ${escapeHtml(code)}). Please try again shortly.</p>`,
      );
      return;
    } else {
      console.log("[Quote] Queuing quote offline");
      queueOfflineSubmission(quote);
    }
  }

  selectors.paymentRefValue.textContent = quote.refCode;
  selectors.paymentRefBox.hidden = false;

  let emailSent = false;
  let emailQueued = false;
  if (storedOnline && navigator.onLine) {
    console.log("[Quote] Sending email now (online)");
    emailSent = await sendQuoteEmail(quote);
  } else {
    console.log("[Quote] Queuing email (offline or failed to persist)");
    emailQueued = true;
  }
  renderEmailPreview(quote);

  if (emailSent) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status success">Quote emailed to <strong>${escapeHtml(emailValue)}</strong>. Preview below.</p>`,
    );
  } else if (storedOnline && !emailQueued) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status warning">Quote saved to dashboard. Email will need to be sent manually.</p>`,
    );
  }

  if (emailQueued) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status info">Email queued. We will send it automatically once the quote syncs online.</p>`,
    );
  }

  if (!storedOnline && !persistError) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status warning">Quote saved offline. We will sync automatically when you are back online.</p>`,
    );
    renderOfflineQueue();
  } else if (storedOnline && !emailSent && !emailQueued) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status warning">Email send failed automatically - please send manually from the dashboard.</p>`,
    );
  }
}

function registerEvents() {
  // Rep code is controlled by authenticated user; keep it read-only
  if (selectors.repCode) {
    selectors.repCode.readOnly = true;
    selectors.repCode.setAttribute("readonly", "");
    selectors.repCode.title = "Populated from your account";
  }

  const syncSlider = (input, output) => {
    if (!input || !output) return;
    output.textContent = input.value;
    input.addEventListener("input", () => {
      output.textContent = input.value;
      renderPricing(calculatePricing());
    });
  };

  syncSlider(selectors.roofLanterns, selectors.roofLanternsValue);
  syncSlider(selectors.skylights, selectors.skylightsValue);

  // Auto-update on changes
  selectors.serviceTier.addEventListener("change", () => {
    console.log("[DEBUG] Service tier changed");
    updateTierCopy();
    renderPricing(calculatePricing());
  });
  if (selectors.houseType) {
    selectors.houseType.addEventListener("change", () => {
      console.log("[DEBUG] House type changed", selectors.houseType.value);
      renderPricing(calculatePricing());
    });
  } else {
    console.warn("[Quote] House type selector not found");
  }
  selectors.houseSize?.addEventListener("change", () => {
    console.log("[DEBUG] House size changed");
    renderPricing(calculatePricing());
  });
  selectors.conservatory?.addEventListener("change", () => {
    console.log("[DEBUG] Conservatory changed");
    renderPricing(calculatePricing());
  });
  selectors.extension?.addEventListener("change", () => {
    console.log("[DEBUG] Extension changed");
    renderPricing(calculatePricing());
  });
  selectors.alternating?.addEventListener("change", () => {
    console.log("[DEBUG] Alternating changed");
    renderPricing(calculatePricing());
  });
  selectors.partialCleaning?.addEventListener("input", () => {
    console.log("[DEBUG] Partial cleaning changed");
    renderPricing(calculatePricing());
  });

  selectors.submitBtn.addEventListener("click", handleSubmit);

  // Track manual edits to the email message
  if (selectors.emailMessage) {
    selectors.emailMessage.addEventListener("input", () => {
      messageTouched = true;
      const pricing = latestPricing || calculatePricing();
      const quote = {
        customerName: selectors.customerName?.value?.trim() || "",
        address: selectors.address?.value?.trim() || "",
        houseSize: selectors.houseSize?.value || "",
        houseType: selectors.houseType?.value || "",
        extension: selectors.extension?.checked || false,
        conservatory: selectors.conservatory?.checked || false,
        skylights: Number(selectors.skylights?.value || 0),
        roofLanterns: Number(selectors.roofLanterns?.value || 0),
        tier: selectors.serviceTier?.value || "",
        pricePerClean: pricing.pricePerClean,
        price: pricing.priceUpfront,
        refCode: selectors.paymentRefValue?.textContent || generateReference(),
      };
      renderEmailPreview(quote);
    });
  }

  // Special Offer toggle
  if (selectors.applyOfferBtn) {
    const syncOfferButtonUi = () => {
      if (!selectors.applyOfferBtn) return;
      selectors.applyOfferBtn.textContent = offerApplied ? "Remove Special Offer" : "Apply Special Offer";
      // Ensure gold styling stays consistent; remove secondary styling if present
      selectors.applyOfferBtn.classList.remove("btn-secondary", "btn-primary");
      selectors.applyOfferBtn.classList.add("btn-offer");
    };
    syncOfferButtonUi();
    selectors.applyOfferBtn.addEventListener("click", () => {
      const tierValue = selectors.serviceTier?.value || "";
      if (!offerApplied) {
        if (tierValue !== "gold") {
          alert("Special Offer applies to Gold tier only. Please select Gold first.");
          selectors.serviceTier?.focus();
          return;
        }
        offerApplied = true;
        offerExpiresAt = computeOfferExpiryIso();
      } else {
        offerApplied = false;
        offerExpiresAt = null;
      }
      syncOfferButtonUi();
      renderPricing(calculatePricing());
    });
  }

  window.addEventListener("online", () => {
    console.log("[Quote] Network online - syncing queue");
    syncQueue();
  });

  selectors.queueAlerts?.addEventListener("click", (event) => {
    const button = event.target.closest(".queue-send");
    if (!button) return;
    handleSendQueuedQuote(button.dataset.ref);
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function initEmailJs() {
  if (window.emailjs && emailjs.init) {
    emailjs.init("7HZRYXz3JmMciex1L");
  }
}

async function initApp() {
  initMenuDropdown();
  initEmailJs();
  registerEvents();
  renderOfflineQueue();
  updateTierCopy();
  // Initial pricing render and ensure result panel is visible
  if (selectors.resultPanel) {
    renderPricing(calculatePricing());
    selectors.resultPanel.hidden = false;
  }
  
  // Set quote date to today
  if (selectors.quoteDate) {
    const today = new Date();
    selectors.quoteDate.value = today.toLocaleDateString("en-GB");
  } else {
    console.warn("Quote date selector not found");
  }
  
  if (selectors.addVAT) {
    selectors.addVAT.value = "true";
    if (selectors.addVAT.type === "checkbox") {
      selectors.addVAT.checked = true;
      selectors.addVAT.disabled = true;
    }
  }
  registerServiceWorker();
  if (navigator.onLine) {
    syncQueue();
  }

  // Setup logout button for authenticated users on quote.html
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/index.html";
      } catch (err) {
        console.error("Logout error:", err);
        alert("Failed to sign out. Please try again.");
      }
    });
  }

  // Setup menu dropdown
  const menuBtn = document.getElementById("menuBtn");
  const menuDropdown = document.getElementById("menuDropdown");
  if (menuBtn && menuDropdown) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle("show");
      menuBtn.setAttribute("aria-expanded", menuDropdown.classList.contains("show"));
    });
    
    // Close menu when clicking on a link
    const menuLinks = menuDropdown.querySelectorAll("a");
    menuLinks.forEach(link => {
        link.addEventListener("click", () => {
          menuDropdown.classList.remove("show");
          menuBtn.setAttribute("aria-expanded", "false");
        });
      });
      
    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
        menuDropdown.classList.remove("show");
        menuBtn.setAttribute("aria-expanded", "false");
      }
    });
  }
}

function startCalculator() {
  console.log("[Quote DEBUG] startCalculator called, readyState:", document.readyState);
  initApp().catch((error) => console.error("Init failed", error));
}

console.log("[Quote DEBUG] Setting up DOMContentLoaded listener. Current readyState:", document.readyState);

if (document.readyState === "loading") {
  console.log("[Quote DEBUG] Document still loading, waiting for DOMContentLoaded");
  document.addEventListener("DOMContentLoaded", startCalculator);
} else {
  console.log("[Quote DEBUG] Document already ready, calling startCalculator immediately");
  startCalculator();
}


