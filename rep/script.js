// Swash Quote Calculator
// Handles quote calculations, Firestore persistence, EmailJS notifications, and offline queuing.

console.log("[Quote DEBUG] script.js module loading...");

import { initMenuDropdown } from "./menu.js";
import { authStateReady, handlePageRouting } from "../auth-check.js";
import { logOutboundEmailToFirestore } from "../lib/firestore-utils.js";
import { tenantCollection, tenantDoc } from "../lib/subscriber-paths.js";
console.log("[Quote DEBUG] menu.js imported successfully");
import {
  queueOfflineSubmission,
  syncQueue,
  getQueue,
  removeFromQueue,
} from "../offline-queue.js";
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
// Expose db for dynamic imports used elsewhere in this module
if (typeof window !== "undefined") {
  window.db = db;
}

const selectors = {};
let latestPricing = null;
let offerApplied = false;
let offerExpiresAt = null;
let messageTouched = false;

const DEFAULT_SUBSCRIBER_SETTINGS = {
  tiers: {
    silver: {
      label: "Silver",
      description: "Window panes only, every 4 weeks, notifications not included.",
    },
    gold: {
      label: "Gold",
      description: "Windows, frames, sills and doors, every 4 weeks, notifications included.",
      multiplier: 1.35,
    },
    offerLabel: "Gold upgrade included",
  },
  pricing: {
    minimum: 16,
    vatIncluded: true,
    baseBySize: {
      "2 bed": 16,
      "3 bed": 21,
      "4 bed": 26,
      "5 bed": 31,
      "6 bed": 36,
    },
    extensionAdd: 4,
    conservatoryAdd: 7,
    roofLanternEach: 10,
    skylightEach: 1.5,
    alternatingFactor: 0.5,
    frontOnlyFactor: 0.5,
  },
  houseTypeMultipliers: {
    "Bungalow": 0.9,
    "Maisonette": 0.94,
    "Terrace": 0.97,
    "Semi-Detached": 1,
    "Detached": 1.05,
    "Mobile Home": 0.9,
  },
  toggles: {
    enableAlternating: true,
    enableFrontOnly: true,
    showOfferButton: true,
    showNotesField: true,
  },
  styling: {
    primaryColor: "#0078d7",
    accentColor: "#0b63b5",
    backgroundColor: "#ffffff",
    buttonTextColor: "#ffffff",
    logoUrl: "",
  },
  frequencyOptions: ["Every 4 weeks", "Every 8 weeks"],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  const base = Array.isArray(target) ? [...target] : { ...target };
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      base[key] = deepMerge(target?.[key] ?? {}, value);
    } else {
      base[key] = value;
    }
  });
  return base;
}

function ensureFrequencyOptions(options) {
  if (!Array.isArray(options) || !options.length) {
    return [...DEFAULT_SUBSCRIBER_SETTINGS.frequencyOptions];
  }
  const cleaned = options
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, arr) => value.length && arr.indexOf(value) === index);
  return cleaned.length ? cleaned : [...DEFAULT_SUBSCRIBER_SETTINGS.frequencyOptions];
}

function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("#")) return null;
  const hex = trimmed.slice(1);
  if (![3, 6, 8].includes(hex.length)) return null;
  const normalized = hex.length === 3
    ? hex.split("").map((char) => char + char).join("")
    : hex.length === 8
      ? hex.slice(0, 6)
      : hex;
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? `#${normalized.toLowerCase()}` : null;
}

function resolveFrequencyDays(label) {
  if (!label) return 28;
  const lower = label.trim().toLowerCase();
  const match = lower.match(/every\s+(\d+(?:\.\d+)?)\s*(week|day|month)/);
  if (match) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0) {
      const unit = match[2];
      if (unit.startsWith("week")) return Math.round(value * 7);
      if (unit.startsWith("month")) return Math.round(value * 30);
      if (unit.startsWith("day")) return Math.round(value);
    }
  }
  if (lower.includes("fortnight")) return 14;
  if (lower.includes("monthly")) return 30;
  if (lower.includes("two")) return 14;
  return 28;
}

const subscriberSettingsState = {
  subscriberId: "",
  loaded: false,
  settings: clone(DEFAULT_SUBSCRIBER_SETTINGS),
};

function getActiveSettings() {
  return subscriberSettingsState.settings || DEFAULT_SUBSCRIBER_SETTINGS;
}

async function loadSubscriberSettings() {
  if (!subscriberSettingsState.subscriberId || subscriberSettingsState.loaded) {
    subscriberSettingsState.settings = {
      ...clone(DEFAULT_SUBSCRIBER_SETTINGS),
      ...subscriberSettingsState.settings,
      frequencyOptions: ensureFrequencyOptions(subscriberSettingsState.settings?.frequencyOptions),
    };
    return;
  }
  try {
    const docRef = tenantDoc(db, subscriberSettingsState.subscriberId, "private", "addCustomerSettings");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      subscriberSettingsState.settings = deepMerge(clone(DEFAULT_SUBSCRIBER_SETTINGS), snap.data());
    } else {
      subscriberSettingsState.settings = clone(DEFAULT_SUBSCRIBER_SETTINGS);
    }
  } catch (error) {
    console.warn("[Quote] Failed to load subscriber settings", error);
    subscriberSettingsState.settings = clone(DEFAULT_SUBSCRIBER_SETTINGS);
  } finally {
    subscriberSettingsState.settings.frequencyOptions = ensureFrequencyOptions(
      subscriberSettingsState.settings.frequencyOptions,
    );
    subscriberSettingsState.loaded = true;
  }
}

// ✅ DETECT EMBED MODE FIRST (before using it)
var params = new URLSearchParams(window.location.search);
var isEmbedMode = params.get("embed") === "true" || window.self !== window.top;
const subscriberIdParam = (params.get("subscriber") || "").trim();
if (subscriberIdParam) {
  subscriberSettingsState.subscriberId = subscriberIdParam;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

async function bootstrap() {
  await waitForDomReady();
  await authStateReady();
  console.log("[Page] Auth ready, userRole:", window.userRole);

  // If embedded, add an embed class to simplify UI (hide global header/nav)
  try {
    if (isEmbedMode) {
      document.body.classList.add("embed");
      // Ensure initial height message goes out early
      setTimeout(() => {
        try {
          const h = document.documentElement.scrollHeight || document.body.scrollHeight;
          parent.postMessage({ type: 'SWASH_IFRAME_HEIGHT', height: h }, '*');
        } catch(_){}
      }, 100);
    }
  } catch (_) {}

  if (!isEmbedMode) {
    const routing = await handlePageRouting("shared");
    if (routing.redirected) {
      console.log("[Quote] Redirect scheduled; halting calculator bootstrap");
      return;
    }
  }

  await delay(100);

  const maintenanceOverlay = document.getElementById("maintenanceOverlay");
  if (maintenanceOverlay) {
    if (window.MAINTENANCE_MODE) {
      document.body.classList.add("maintenance-active");
      maintenanceOverlay.style.display = "flex";
    } else {
      document.body.classList.remove("maintenance-active");
      maintenanceOverlay.style.display = "none";
    }
  }

  await loadSubscriberSettings();

  Object.assign(selectors, {
    repCode: document.getElementById("repCode"),
    quoteDate: document.getElementById("quoteDate"),
    serviceTier: document.getElementById("serviceTier"),
    tierDescription: document.getElementById("tierDescription"),
    houseType: document.getElementById("houseType"),
    houseSize: document.getElementById("houseSize"),
    cleaningFrequency: document.getElementById("cleaningFrequency"),
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
    upfrontPayment: document.getElementById("upfrontPayment"),
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
    frontOnly: document.getElementById("frontOnly"),
    emailMessage: document.getElementById("emailMessage"),
  });

  applySubscriberConfiguration();

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

  const updateDateField = () => {
    if (selectors.quoteDate) {
      const today = new Date();
      selectors.quoteDate.value = today.toLocaleDateString("en-GB");
    }
  };
  updateDateField();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const repInput = selectors.repCode;
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

  // Update date field every minute to ensure it stays current if page is left open
  setInterval(updateDateField, 60000);

  await initApp();
}

// --- UTILITY FUNCTIONS ---
function normaliseEmail(value) {
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

const tierDetails = {
  silver: "Window panes only, every 4 weeks, notifications not included.",
  gold: "Windows, frames, sills and doors, every 4 weeks, notifications included.",
  "gold-for-silver": "Windows, frames, sills and doors, every 4 weeks, notifications included - FREE Upgrade.",
};

function calculatePricing() {
  const settings = getActiveSettings();
  const pricingConfig = settings.pricing || {};
  const toggles = settings.toggles || {};

  const minimum = Number(pricingConfig.minimum ?? 0) || 0;
  const selectedSize = selectors.houseSize?.value || "2 bed";
  const selectedHouseType = selectors.houseType?.value || "Semi-Detached";
  const basePrice = Number(pricingConfig.baseBySize?.[selectedSize] ?? minimum);
  const houseMultiplier = Number(settings.houseTypeMultipliers?.[selectedHouseType] ?? 1);

  const tierRaw = selectors.serviceTier?.value || "gold";
  const isOffer = offerApplied && tierRaw === "gold";
  const effectiveTier = isOffer ? "silver" : tierRaw;
  const tierMultiplier = effectiveTier === "gold"
    ? Number(settings.tiers?.gold?.multiplier ?? 1)
    : 1;

  let price = basePrice * houseMultiplier * (Number.isFinite(tierMultiplier) && tierMultiplier > 0 ? tierMultiplier : 1);

  if (selectors.extension?.checked) {
    price += Number(pricingConfig.extensionAdd ?? 0);
  }
  if (selectors.conservatory?.checked) {
    price += Number(pricingConfig.conservatoryAdd ?? 0);
  }

  const lanterns = clamp(Number(selectors.roofLanterns?.value) || 0, 0, 50);
  const skylights = clamp(Number(selectors.skylights?.value) || 0, 0, 50);
  price += lanterns * Number(pricingConfig.roofLanternEach ?? 0);
  price += skylights * Number(pricingConfig.skylightEach ?? 0);

  if (selectors.alternating?.checked && (toggles.enableAlternating !== false)) {
    const alternatingFactor = Number(pricingConfig.alternatingFactor ?? 1);
    price *= Number.isFinite(alternatingFactor) && alternatingFactor > 0 ? alternatingFactor : 1;
  }

  if (selectors.frontOnly?.checked && (toggles.enableFrontOnly !== false)) {
    const frontOnlyFactor = Number(pricingConfig.frontOnlyFactor ?? 1);
    price *= Number.isFinite(frontOnlyFactor) && frontOnlyFactor > 0 ? frontOnlyFactor : 1;
  }

  const partialPercentage = clamp(Number(selectors.partialCleaning?.value) || 100, 0, 100);
  price *= partialPercentage / 100;

  if (!Number.isFinite(price) || price <= 0) {
    price = minimum;
  }

  price = Math.max(price, minimum);

  const perClean = Math.round(price * 100) / 100;
  const upfront = Math.round(perClean * 3 * 100) / 100;

  return {
    pricePerClean: Number(perClean.toFixed(2)),
    priceUpfront: Number(upfront.toFixed(2)),
  };
}

function renderPricing(pricing) {
  const computed = pricing || calculatePricing();
  latestPricing = computed;

  if (!selectors.resultPanel) {
    console.warn("[Quote] Missing result panel element; cannot render pricing");
    return;
  }

  const settings = getActiveSettings();
  const vatIncluded = settings.pricing?.vatIncluded !== false;
  const minimumPrice = Number(settings.pricing?.minimum ?? 0);
  const offerActive = offerApplied && selectors.serviceTier?.value === "gold";
  const frequencyLabel = selectors.cleaningFrequency?.value || settings.frequencyOptions?.[0];

  const offerHtml = offerActive
    ? `<p class="result-offer">${escapeHtml(settings.tiers?.offerLabel || "Special offer applied")}</p>`
    : "";
  const minimumHtml = Number.isFinite(minimumPrice) && minimumPrice > 0
    ? `<p class="result-minimum">Minimum clean price: ${formatCurrency(minimumPrice)}</p>`
    : "";
  const vatHtml = vatIncluded ? "" : `<p class="result-note">Prices exclude VAT.</p>`;
  const frequencyHtml = frequencyLabel ? `<p class="result-note">Cleaning frequency: ${escapeHtml(frequencyLabel)}</p>` : "";

  // Find or create the result-box (preserve status messages)
  let resultBox = selectors.resultPanel.querySelector(".result-box");
  if (!resultBox) {
    resultBox = document.createElement("div");
    resultBox.className = "result-box";
    selectors.resultPanel.insertBefore(resultBox, selectors.resultPanel.firstChild);
  }
  
  const showUpfront = !!selectors.upfrontPayment?.checked;
  resultBox.innerHTML = `
    <p class="result-price"><strong>Price per clean:</strong> ${formatCurrency(computed.pricePerClean)}</p>
    ${showUpfront ? `<p class="result-upfront">Advance payment (3 cleans): ${formatCurrency(computed.priceUpfront)}</p>` : ""}
    ${offerHtml}
    ${minimumHtml}
    ${vatHtml}
    ${frequencyHtml}
  `;

  selectors.resultPanel.hidden = false;
  // Always show customer section when price is calculated (needed for modal flow)
  if (selectors.customerSection) {
    selectors.customerSection.hidden = false;
  }

  console.log("[Quote] Pricing updated", {
    pricePerClean: computed.pricePerClean,
    priceUpfront: computed.priceUpfront,
    offerApplied: offerActive,
  });
}

function applyThemeVariables() {
  const styling = getActiveSettings().styling || {};
  const primary = normalizeHexColor(styling.primaryColor) || "#0078d7";
  const accent = normalizeHexColor(styling.accentColor) || primary;
  const buttonText = normalizeHexColor(styling.buttonTextColor) || "#ffffff";
  const background = normalizeHexColor(styling.backgroundColor);

  const root = document.documentElement;
  if (root) {
    root.style.setProperty("--swash-blue", primary);
    root.style.setProperty("--swash-blue-dark", accent);
  }

  const primaryButtons = [selectors.submitBtn].filter(Boolean);
  primaryButtons.forEach((btn) => {
    btn.style.backgroundColor = accent;
    btn.style.borderColor = accent;
    btn.style.color = buttonText;
  });

  if (selectors.applyOfferBtn) {
    selectors.applyOfferBtn.style.backgroundColor = primary;
    selectors.applyOfferBtn.style.borderColor = primary;
    selectors.applyOfferBtn.style.color = buttonText;
  }

  if (background) {
    document.body.style.backgroundColor = background;
  }
}

function applySubscriberConfiguration() {
  const settings = getActiveSettings();
  try {
    if (selectors.serviceTier) {
      const goldOption = selectors.serviceTier.querySelector('option[value="gold"]');
      const silverOption = selectors.serviceTier.querySelector('option[value="silver"]');
      if (goldOption && settings.tiers?.gold?.label) {
        goldOption.textContent = settings.tiers.gold.label;
      }
      if (silverOption && settings.tiers?.silver?.label) {
        silverOption.textContent = settings.tiers.silver.label;
      }
    }

    if (selectors.applyOfferBtn) {
      if (settings.tiers?.offerLabel) {
        selectors.applyOfferBtn.textContent = settings.tiers.offerLabel;
      }
      const offerWrapper = selectors.applyOfferBtn.closest(".form-actions");
      if (offerWrapper) {
        const visible = settings.toggles?.showOfferButton !== false;
        offerWrapper.style.display = visible ? "" : "none";
        if (!visible) {
          offerApplied = false;
          offerExpiresAt = null;
        }
      }
    }

    if (selectors.notes) {
      const notesLabel = selectors.notes.closest("label");
      if (notesLabel) {
        const showNotes = settings.toggles?.showNotesField !== false;
        notesLabel.style.display = showNotes ? "" : "none";
        if (!showNotes) selectors.notes.value = "";
        selectors.notes.disabled = !showNotes;
      }
    }

    const alternatingLabel = selectors.alternating?.closest("label");
    if (selectors.alternating && alternatingLabel) {
      const enabled = settings.toggles?.enableAlternating !== false;
      alternatingLabel.style.display = enabled ? "" : "none";
      selectors.alternating.disabled = !enabled;
      if (!enabled) selectors.alternating.checked = false;
    }

    const frontOnlyLabel = selectors.frontOnly?.closest("label");
    if (selectors.frontOnly && frontOnlyLabel) {
      const enabled = settings.toggles?.enableFrontOnly !== false;
      frontOnlyLabel.style.display = enabled ? "" : "none";
      selectors.frontOnly.disabled = !enabled;
      if (!enabled) selectors.frontOnly.checked = false;
    }

    if (selectors.cleaningFrequency) {
      const existingValue = selectors.cleaningFrequency.value;
      selectors.cleaningFrequency.innerHTML = "";
      const options = ensureFrequencyOptions(settings.frequencyOptions);
      options.forEach((label, index) => {
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        if ((existingValue && existingValue === label) || (!existingValue && index === 0)) {
          option.selected = true;
        }
        selectors.cleaningFrequency.appendChild(option);
      });
      if (!selectors.cleaningFrequency.value && options.length) {
        selectors.cleaningFrequency.value = options[0];
      }
    }
  } catch (error) {
    console.warn("[Quote] Failed to apply subscriber configuration", error);
  }

  applyThemeVariables();
  updateTierCopy();
  renderPricing(calculatePricing());
}
// Debug helper: logs pricing calculation steps for sample configurations
window.debugPricing = function debugPricing(samples = []) {
  if (!Array.isArray(samples) || !samples.length) {
    samples = [
      { tier: 'silver', houseType: 'semi-detached', houseSize: '3 bed', extension: false, conservatory: false, skylights: 0, roofLanterns: 0, alternating: false, partialCleaning: 100 },
      { tier: 'gold', houseType: 'detached', houseSize: '4 bed', extension: true, conservatory: true, skylights: 2, roofLanterns: 1, alternating: false, partialCleaning: 100 },
      { tier: 'gold', houseType: 'terrace', houseSize: '2 bed', extension: false, conservatory: false, skylights: 0, roofLanterns: 0, alternating: true, partialCleaning: 80 },
    ];
  }
  console.group('[Pricing] DebugRun');
  samples.forEach((cfg, idx) => {
    try {
      selectors.serviceTier.value = cfg.tier;
      selectors.houseType.value = cfg.houseType;
      selectors.houseSize.value = cfg.houseSize;
      selectors.extension.checked = !!cfg.extension;
      selectors.conservatory.checked = !!cfg.conservatory;
      selectors.skylights.value = cfg.skylights;
      selectors.roofLanterns.value = cfg.roofLanterns;
      selectors.alternating.checked = !!cfg.alternating;
      selectors.partialCleaning.value = cfg.partialCleaning;
      const pricing = calculatePricing();
      console.log(`[Pricing] Sample#${idx+1}`, { cfg, pricing });
    } catch (err) {
      console.warn('[Pricing] Sample error', idx+1, err);
    }
  });
  console.groupEnd();
};
function buildEmailMessage(quote) {
  if (!quote) return "";
  const pricePer = formatCurrency(quote.pricePerClean);
  const extrasLabel = buildExtrasLabel(quote);
  const planLabel = (quote.tier || "Silver").charAt(0).toUpperCase() + (quote.tier || "Silver").slice(1);
  const offerApplied = !!quote.offerApplied && quote.tier === "gold";
  const offerExpiresAt = quote.offerExpiresAt;
  const frequencyLabel = quote.cleaningFrequency || "Every 4 weeks";
  let offerLine = "";
  if (offerApplied) {
    const expires = offerExpiresAt ? new Date(offerExpiresAt) : null;
    const expiryStr = expires ? expires.toLocaleDateString("en-GB") : "soon";
    offerLine = `\n\nGet the next bit done quickly — this offer expires on ${expiryStr}!`;
  }
  return [
    `Hi ${quote.customerName}, your ${quote.houseSize} ${quote.houseType}` +
      `${extrasLabel && extrasLabel !== "Standard clean" ? ` with ${extrasLabel}` : ""}` +
      ` will all be kept clean soon at ${quote.address}.`,
    `You are on our ${planLabel} plan${offerApplied ? " (special offer applied)" : ""}, and the price per clean (${frequencyLabel}) is ${pricePer}.` + offerLine,
    `We collect payment for regular window cleaning services 3 months in advance so we can focus on doing a great job with less time messing around with payments.`,
    `Use the details below to make a bank transfer using this reference code: ${quote.refCode}`,
    `Business Acc Name: SWASH CLEANING LTD`,
    `Account Number: 65069359`,
    `Sort Code: 23-01-20`,
    `Amount: ${formatCurrency(quote.price)}`,
    `When this is done we'll book you in for when we are next in your area on our 4 weekly round.`
  ].join("\n\n");
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

// (removed stray preview rendering block)

function updateTierCopy() {
  if (!selectors.tierDescription || !selectors.serviceTier) return;
  const settings = getActiveSettings();
  const rawValue = selectors.serviceTier.value || "gold";
  const isOffer = offerApplied && rawValue === "gold";
  const effectiveTier = isOffer ? "silver" : rawValue;
  let copy = "";
  if (effectiveTier === "gold" && settings.tiers?.gold?.description) {
    copy = settings.tiers.gold.description;
  } else if (effectiveTier === "silver" && settings.tiers?.silver?.description) {
    copy = settings.tiers.silver.description;
  }
  if (!copy && offerApplied && rawValue === "gold" && settings.tiers?.offerLabel) {
    copy = settings.tiers.offerLabel;
  }
  if (!copy && tierDetails[effectiveTier]) {
    copy = tierDetails[effectiveTier];
  }
  if (!copy) {
    copy = "Select a service tier to see the details.";
  }
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
    try {
      await logOutboundEmailToFirestore({
        to: recipient,
        subject: "Your Swash Window Cleaning Quote",
        body: message,
        source: "quote-calculator",
      });
    } catch (logError) {
      console.warn("[Quote] Failed to log outbound quote email", logError);
    }
    
    // Log successful send to Firestore if quote has ID
    if (quote.id && window.db) {
      try {
        const { updateDoc, arrayUnion } = await import(
          "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js"
        );
        const sentBy = getRepIdentity();
        const quoteDocRef = tenantDoc(
          window.db,
          quote.subscriberId || subscriberSettingsState.subscriberId,
          "quotes",
          quote.id,
        );
        await updateDoc(quoteDocRef, {
          emailLog: arrayUnion({
            type: "quote",
            subject: "Your Swash Window Cleaning Quote",
            sentAt: Date.now(),
            sentTo: recipient,
            success: true,
            body: message,
            sentBy,
          })
        });
      } catch (logError) {
        // Often blocked by rules for non-admins; not user-facing
        if (console.debug) console.debug("Email send logged locally; server log skipped", logError?.code || logError);
      }
    }
    
    return true;
  } catch (error) {
    console.warn("EmailJS send failed", error);
    
    // Log failed send to Firestore if quote has ID
    if (quote.id && window.db) {
      try {
        const { updateDoc, arrayUnion } = await import(
          "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js"
        );
        const sentBy = getRepIdentity();
        const quoteDocRef = tenantDoc(
          window.db,
          quote.subscriberId || subscriberSettingsState.subscriberId,
          "quotes",
          quote.id,
        );
        await updateDoc(quoteDocRef, {
          emailLog: arrayUnion({
            type: "quote",
            subject: "Your Swash Window Cleaning Quote",
            sentAt: Date.now(),
            sentTo: recipient,
            success: false,
            error: error?.text || error?.message || "Send failed",
            body: message,
            sentBy,
          })
        });
      } catch (logError) {
        if (console.debug) console.debug("Email failure log skipped (rules)", logError?.code || logError);
      }
    }
    
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

function getRepIdentity() {
  try {
    const repCode = selectors?.repCode?.value || undefined;
    const user = auth?.currentUser || null;
    return {
      uid: user?.uid || null,
      email: user?.email || null,
      repCode: repCode || null,
      source: "rep-quote",
    };
  } catch (_) {
    return { source: "rep-quote" };
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
    const targetCollection = tenantCollection(db, quote.subscriberId || subscriberSettingsState.subscriberId, "quotes");
    const docRef = await addDoc(targetCollection, {
      ...quote,
      createdAt: serverTimestamp(),
    });
    if (docRef?.id) {
      // Attach Firestore document ID so downstream email logging works
      quote.id = docRef.id;
    }
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
  // Allow public submissions without authentication
  // If user is authenticated, their info will be used; otherwise form will be submitted publicly
  
  if (!validateCustomerFields()) {
    console.warn("[Quote] Customer field validation failed");
    return;
  }

  // Enforce pinned location requirement before quote submission
  try {
    const latVal = document.getElementById('customerLatitude')?.value;
    const lngVal = document.getElementById('customerLongitude')?.value;
    if (!latVal || !lngVal) {
      selectors.resultPanel?.insertAdjacentHTML(
        'beforeend',
        '<p class="status warning">Please pin the customer location ("Set Location on Map") before saving the quote.</p>'
      );
      return;
    }
  } catch(_) {}

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

  const frequencySelection = selectors.cleaningFrequency?.value || getActiveSettings().frequencyOptions?.[0] || "Every 4 weeks";
  const frequencyDaysRaw = resolveFrequencyDays(frequencySelection);
  const frequencyDays = Number.isFinite(frequencyDaysRaw) && frequencyDaysRaw > 0 ? frequencyDaysRaw : 28;
  const frequencyWeeks = Math.round((frequencyDays / 7) * 100) / 100;

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
    cleaningFrequency: frequencySelection,
    cleaningFrequencyIntervalDays: frequencyDays,
    cleaningFrequencyDays: frequencyDays,
    cleaningFrequencyWeeks: frequencyWeeks,
    refCode: generateReference(),
    status: "Pending Payment",
    notes: selectors.notes.value.trim(),
    customerLatitude: document.getElementById("customerLatitude")?.value ? parseFloat(document.getElementById("customerLatitude").value) : null,
    customerLongitude: document.getElementById("customerLongitude")?.value ? parseFloat(document.getElementById("customerLongitude").value) : null,
    // Offer metadata (for admin auto-revert)
    offerApplied: !!offerApplied,
    offerType: offerApplied ? "gold-for-silver" : null,
    offerExpiresAt: offerApplied && offerExpiresAt ? offerExpiresAt : null,
    subscriberId: subscriberSettingsState.subscriberId || null,
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

  // Store status messages to show AFTER form reset
  const statusMessages = [];
  
  if (emailSent) {
    statusMessages.push(`<p class="status success">✅ Quote emailed to <strong>${escapeHtml(emailValue)}</strong> and saved to dashboard.</p>`);
  } else if (storedOnline && !emailQueued) {
    statusMessages.push(`<p class="status warning">Quote saved to dashboard. Email will need to be sent manually.</p>`);
  }

  if (emailQueued) {
    statusMessages.push(`<p class="status info">Email queued. We will send it automatically once the quote syncs online.</p>`);
  }

  if (!storedOnline && !persistError) {
    statusMessages.push(`<p class="status warning">Quote saved offline. We will sync automatically when you are back online.</p>`);
    renderOfflineQueue();
  } else if (storedOnline && !emailSent && !emailQueued) {
    statusMessages.push(`<p class="status warning">Email send failed automatically - please send manually from the dashboard.</p>`);
  }

  // Clear all form fields after submission (reset for next sale)
  if (selectors.customerName) selectors.customerName.value = "";
  if (selectors.address) selectors.address.value = "";
  if (selectors.mobile) selectors.mobile.value = "";
  if (selectors.email) selectors.email.value = "";
  if (selectors.houseType) selectors.houseType.selectedIndex = 0;
  if (selectors.houseSize) selectors.houseSize.selectedIndex = 0;
  if (selectors.conservatory) selectors.conservatory.checked = false;
  if (selectors.extension) selectors.extension.checked = false;
  if (selectors.roofLanterns) {
    selectors.roofLanterns.value = 0;
    if (selectors.roofLanternsValue) selectors.roofLanternsValue.textContent = "0";
  }
  if (selectors.skylights) {
    selectors.skylights.value = 0;
    if (selectors.skylightsValue) selectors.skylightsValue.textContent = "0";
  }
  if (selectors.partialCleaning) selectors.partialCleaning.value = 100;
  if (selectors.alternating) selectors.alternating.checked = false;
  if (selectors.frontOnly) selectors.frontOnly.checked = false;
  if (selectors.notes) selectors.notes.value = "";
  if (selectors.customerLatitude) selectors.customerLatitude.value = "";
  if (selectors.customerLongitude) selectors.customerLongitude.value = "";
  if (selectors.emailMessage) selectors.emailMessage.value = "";
  
  // Hide email preview and payment reference box for next sale
  if (selectors.emailPreviewCard) selectors.emailPreviewCard.hidden = true;
  if (selectors.paymentRefBox) selectors.paymentRefBox.hidden = true;
  
  // Reset offer state
  offerApplied = false;
  offerExpiresAt = null;
  
  // Clear old status messages from result panel
  selectors.resultPanel?.querySelectorAll(".status").forEach((node) => node.remove());
  
  // Always recalculate and show price after reset
  renderPricing(calculatePricing());
  
  // Now add the status messages AFTER form reset so they stay visible
  if (statusMessages.length > 0 && selectors.resultPanel) {
    statusMessages.forEach(msg => {
      selectors.resultPanel.insertAdjacentHTML("beforeend", msg);
    });
    
    // Scroll to show the status message in embed/modal
    try {
      const lastStatus = selectors.resultPanel.querySelector(".status:last-child");
      if (lastStatus) {
        lastStatus.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (_) {}
    
    // Update iframe height if in embed mode
    if (isEmbedMode) {
      try {
        const h = document.documentElement.scrollHeight || document.body.scrollHeight;
        parent.postMessage({ type: 'SWASH_IFRAME_HEIGHT', height: h }, '*');
      } catch(_){}
    }
  }
}

// ===== LOCATION MODAL =====
let locationMap = null;
let locationMarker = null;

function updateLocationPickerPosition(lat, lng, options = {}) {
  const locationLatInput = document.getElementById("locationLatInput");
  const locationLngInput = document.getElementById("locationLngInput");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !locationLatInput || !locationLngInput) return;

  console.log('[Location] updateLocationPickerPosition called:', { lat, lng, options });

  locationLatInput.value = Number(lat).toFixed(6);
  locationLngInput.value = Number(lng).toFixed(6);
  console.log('[Location] Input fields updated:', { latValue: locationLatInput.value, lngValue: locationLngInput.value });

  if (locationMarker) {
    locationMarker.setPosition({ lat, lng });
    console.log('[Location] Marker position updated');
  } else {
    console.warn('[Location] locationMarker not initialized');
  }

  if (locationMap && options.pan !== false) {
    locationMap.panTo({ lat, lng });
    console.log('[Location] Map panned to', { lat, lng });
  } else if (locationMap) {
    console.log('[Location] pan disabled');
  } else {
    console.warn('[Location] locationMap not initialized');
  }

  if (locationMap && Number.isFinite(options.zoom)) {
    locationMap.setZoom(options.zoom);
    console.log('[Location] Map zoom set to', options.zoom);
  }
}

function geocodeCustomerAddress(address) {
  return new Promise((resolve) => {
    if (!address) {
      resolve(null);
      return;
    }

    if (!window.google?.maps?.Geocoder) {
      console.warn('[Location] Geocoder unavailable');
      resolve(null);
      return;
    }

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        resolve(results[0]);
      } else {
        console.warn('[Location] Geocode failed for address', address, 'status:', status);
        resolve(null);
      }
    });
  });
}

function requestCurrentPositionForLocationModal() {
  const statusEl = document.getElementById("locationGpsStatus");
  if (!navigator?.geolocation) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "#b45309";
      statusEl.textContent = "Device location isn’t available in this browser. Drag the pin manually.";
    }
    return;
  }

  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.style.color = "#0369a1";
    statusEl.textContent = "Detecting your current location…";
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords || {};
      console.log('[Location] GPS Position received:', { latitude, longitude, accuracy: accuracy ? accuracy + 'm' : 'unknown' });
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        updateLocationPickerPosition(latitude, longitude, { zoom: 18 });
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#047857";
          const accuracyText = accuracy ? ` (Accuracy: ${Math.round(accuracy)}m)` : '';
          statusEl.textContent = "Location detected from your device. Save to confirm." + accuracyText;
        }
      }
    },
    (err) => {
      console.warn("[Location] Geolocation failed", err);
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Couldn't use device location. Drag the pin to the property.";
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function initLocationModal() {
  const setLocationBtn = document.getElementById("setLocationBtn");
  const closeLocationModal = document.getElementById("closeLocationModal");
  const cancelLocationBtn = document.getElementById("cancelLocationBtn");
  const saveLocationBtn = document.getElementById("saveLocationBtn");
  const setCustomerLocationModal = document.getElementById("setCustomerLocationModal");
  const locationLatInput = document.getElementById("locationLatInput");
  const locationLngInput = document.getElementById("locationLngInput");
  const customerLatitude = document.getElementById("customerLatitude");
  const customerLongitude = document.getElementById("customerLongitude");
  const locationGpsStatus = document.getElementById("locationGpsStatus");

  if (!setLocationBtn) return;

  setLocationBtn.addEventListener("click", async () => {
    const address = selectors.address?.value?.trim();
    if (!address) {
      alert("Please enter a customer address first");
      return;
    }
    
    // Reset map and marker before opening modal
    locationMap = null;
    locationMarker = null;
    if (locationGpsStatus) {
      locationGpsStatus.textContent = "";
      locationGpsStatus.style.display = "none";
      locationGpsStatus.style.color = "#0369a1";
    }
    
    setCustomerLocationModal.hidden = false;
    await delay(100);
    const geocoded = await initLocationMapIfNeeded(address);

    const lat = parseFloat(customerLatitude?.value);
    const lng = parseFloat(customerLongitude?.value);
    const hasExistingCoords = Number.isFinite(lat) && Number.isFinite(lng);
    if (hasExistingCoords) {
      if (locationGpsStatus) {
        locationGpsStatus.style.display = "block";
        locationGpsStatus.style.color = "#475569";
        locationGpsStatus.textContent = "Using the previously saved location for this customer.";
      }
    } else if (!geocoded) {
      requestCurrentPositionForLocationModal();
    }
  });

  closeLocationModal?.addEventListener("click", () => {
    setCustomerLocationModal.hidden = true;
  });

  cancelLocationBtn?.addEventListener("click", () => {
    setCustomerLocationModal.hidden = true;
  });

  saveLocationBtn?.addEventListener("click", () => {
    const lat = parseFloat(locationLatInput?.value);
    const lng = parseFloat(locationLngInput?.value);

    if (isNaN(lat) || isNaN(lng)) {
      alert("Please set a valid location on the map");
      return;
    }

    customerLatitude.value = lat;
    customerLongitude.value = lng;
    setCustomerLocationModal.hidden = true;
    alert(`✓ Location saved: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    
    // Trigger booking date regeneration if the booking UI is visible
    if (typeof window.generateSuggestedDates === 'function') {
      setTimeout(() => {
        try {
          window.generateSuggestedDates();
        } catch(e) {
          console.warn('Failed to regenerate dates after location save', e);
        }
      }, 300);
    }
  });

  // Input listeners for manual coordinate entry
  locationLatInput?.addEventListener("change", () => {
    const lat = parseFloat(locationLatInput.value);
    const lng = parseFloat(locationLngInput?.value);
    if (!isNaN(lat) && !isNaN(lng) && locationMap && locationMarker) {
      locationMarker.setPosition({ lat, lng });
      locationMap.panTo({ lat, lng });
    }
  });

  locationLngInput?.addEventListener("change", () => {
    const lat = parseFloat(locationLatInput?.value);
    const lng = parseFloat(locationLngInput.value);
    if (!isNaN(lat) && !isNaN(lng) && locationMap && locationMarker) {
      locationMarker.setPosition({ lat, lng });
      locationMap.panTo({ lat, lng });
    }
  });
}

async function initLocationMapIfNeeded(address) {
  if (locationMap) return false; // Already initialized

  console.log('[Location] initLocationMapIfNeeded called with address:', address);

  const mapElement = document.getElementById("locationMap");
  const locationAddressDisplay = document.getElementById("locationAddressDisplay");
  const locationLatInput = document.getElementById("locationLatInput");
  const locationLngInput = document.getElementById("locationLngInput");
  const locationGpsStatus = document.getElementById("locationGpsStatus");

  if (!mapElement) {
    console.error('[Location] mapElement not found');
    return false;
  }

  locationAddressDisplay.textContent = address;

  // Try to get existing coordinates or use defaults
  const customerLatitude = document.getElementById("customerLatitude");
  const customerLongitude = document.getElementById("customerLongitude");
  let initialLat = customerLatitude?.value ? parseFloat(customerLatitude.value) : 51.7356;
  let initialLng = customerLongitude?.value ? parseFloat(customerLongitude.value) : 0.6756;

  console.log('[Location] Initializing map with:', { initialLat, initialLng, hasSavedCoords: !!(customerLatitude?.value && customerLongitude?.value) });

  // Create map with initial position
  locationMap = new google.maps.Map(mapElement, {
    zoom: 15,
    center: { lat: initialLat, lng: initialLng },
    mapTypeId: "roadmap",
  });

  locationMarker = new google.maps.Marker({
    position: { lat: initialLat, lng: initialLng },
    map: locationMap,
    draggable: true,
    title: "Customer location",
  });

  locationLatInput.value = initialLat.toFixed(6);
  locationLngInput.value = initialLng.toFixed(6);

  // Update inputs when marker is dragged
  locationMarker.addListener("drag", () => {
    const pos = locationMarker.getPosition();
    const lat = pos.lat();
    const lng = pos.lng();
    locationLatInput.value = lat.toFixed(6);
    locationLngInput.value = lng.toFixed(6);
    console.log('[Location] Marker dragged to:', { lat, lng });
  });

  // Update marker position when map is clicked
  locationMap.addListener("click", (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    locationMarker.setPosition({ lat, lng });
    locationLatInput.value = lat.toFixed(6);
    locationLngInput.value = lng.toFixed(6);
    console.log('[Location] Map clicked, marker moved to:', { lat, lng });
  });

  let usedGeocode = false;
  const hasSavedCoords = Boolean(customerLatitude?.value && customerLongitude?.value);
  if (!hasSavedCoords && address) {
    if (locationGpsStatus) {
      locationGpsStatus.style.display = "block";
      locationGpsStatus.style.color = "#0369a1";
      locationGpsStatus.textContent = "Locating the property…";
    }

    const geocodeResult = await geocodeCustomerAddress(address);
    if (geocodeResult?.geometry?.location) {
      const location = geocodeResult.geometry.location;
      const lat = location.lat();
      const lng = location.lng();

      const options = {};
      if (!geocodeResult.geometry.viewport) {
        options.zoom = 17;
      }

      updateLocationPickerPosition(lat, lng, options);
      if (geocodeResult.geometry.viewport && locationMap) {
        locationMap.fitBounds(geocodeResult.geometry.viewport);
      }

      usedGeocode = true;
      if (locationGpsStatus) {
        locationGpsStatus.style.display = "block";
        locationGpsStatus.style.color = "#047857";
        const formatted = geocodeResult.formatted_address || address;
        locationGpsStatus.textContent = `Pinned using customer address: ${formatted}. Adjust if needed.`;
      }
    } else if (locationGpsStatus) {
      locationGpsStatus.style.display = "block";
      locationGpsStatus.style.color = "#b45309";
      locationGpsStatus.textContent = "Couldn't find that address automatically. Use device location or drag the pin.";
    }
  }

  return usedGeocode;
}

function registerEvents() {
  console.log("[Quote] registerEvents called, selectors check:", {
    serviceTier: !!selectors.serviceTier,
    submitBtn: !!selectors.submitBtn,
    roofLanterns: !!selectors.roofLanterns,
  });
  
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
  if (selectors.serviceTier) {
    selectors.serviceTier.addEventListener("change", () => {
      console.log("[DEBUG] Service tier changed");
      updateTierCopy();
      renderPricing(calculatePricing());
    });
  }
  if (selectors.houseType) {
    selectors.houseType.addEventListener("change", () => {
      console.log("[DEBUG] House type changed", selectors.houseType.value);
      renderPricing(calculatePricing());
    });
  } else {
    console.warn("[Quote] House type selector not found");
  }
  if (selectors.houseSize) {
    selectors.houseSize.addEventListener("change", () => {
      console.log("[DEBUG] House size changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.cleaningFrequency) {
    selectors.cleaningFrequency.addEventListener("change", () => {
      console.log("[DEBUG] Cleaning frequency changed", selectors.cleaningFrequency.value);
      renderPricing(calculatePricing());
    });
  }
  if (selectors.conservatory) {
    selectors.conservatory.addEventListener("change", () => {
      console.log("[DEBUG] Conservatory changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.extension) {
    selectors.extension.addEventListener("change", () => {
      console.log("[DEBUG] Extension changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.alternating) {
    selectors.alternating.addEventListener("change", () => {
      console.log("[DEBUG] Alternating changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.frontOnly) {
    selectors.frontOnly.addEventListener("change", () => {
      console.log("[DEBUG] Front Only changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.upfrontPayment) {
    selectors.upfrontPayment.addEventListener("change", () => {
      console.log("[DEBUG] Upfront payment toggle changed");
      renderPricing(calculatePricing());
    });
  }
  if (selectors.partialCleaning) {
    selectors.partialCleaning.addEventListener("input", () => {
      console.log("[DEBUG] Partial cleaning changed");
      renderPricing(calculatePricing());
    });
  }

  if (selectors.submitBtn) {
    selectors.submitBtn.addEventListener("click", () => {
      // If payment completed and confirm button exists, delegate to booking confirmation
      try {
        const banner = document.getElementById('paymentSuccessBanner');
        const confirmBtn = document.getElementById('confirmBookingBtn');
        if (banner && confirmBtn) {
          confirmBtn.click();
          return;
        }
      } catch (_) {}
      // Fallback to original quote submission flow
      handleSubmit();
    });
  }

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
      const label = getActiveSettings().tiers?.offerLabel || "Apply Special Offer";
      selectors.applyOfferBtn.textContent = offerApplied ? "Remove Special Offer" : label;
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
      updateTierCopy();
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
    await navigator.serviceWorker.register("../service-worker.js");
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
  console.log("[Quote] initApp started, selectors available:", !!selectors.serviceTier);
  initMenuDropdown();
  initEmailJs();
  initLocationModal();
  registerEvents();
  renderOfflineQueue();
  updateTierCopy();
  
  // Always show customer section immediately (needed for modal flow)
  if (selectors.customerSection) {
    selectors.customerSection.hidden = false;
  }
  
  // Initial pricing render and ensure result panel is visible
  if (selectors.resultPanel && selectors.serviceTier) {
    const pricing = calculatePricing();
    console.log("[Quote] Initial pricing calc:", pricing);
    renderPricing(pricing);
    selectors.resultPanel.hidden = false;
  } else {
    console.warn("[Quote] Missing resultPanel or serviceTier:", {
      resultPanel: !!selectors.resultPanel,
      serviceTier: !!selectors.serviceTier,
    });
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

  // Setup logout button for authenticated users on add-new-customer.html
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
}

bootstrap().catch((error) => console.error("Bootstrap failed", error));


