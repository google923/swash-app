// Swash Quote Calculator - Embedded Version (No Auth Required)
// For embedding on external websites via iframe

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
  resultContent: document.getElementById("resultContent"),
};

// Mark page as embedded when in an iframe or ?embed=true
try {
  const params = new URLSearchParams(location.search);
  const isEmbedded = (function(){
    try { return window.self !== window.top; } catch (_) { return true; }
  })() || params.get("embed") === "true";
  if (isEmbedded) {
    document.body.classList.add("embed-mode");
  }
} catch (_) {
  // no-op
}

if (selectors.repCode) {
  selectors.repCode.setAttribute("autocomplete", "off");
  selectors.repCode.setAttribute("autocorrect", "off");
  selectors.repCode.setAttribute("autocapitalize", "characters");
  selectors.repCode.setAttribute("spellcheck", "false");
  selectors.repCode.setAttribute("inputmode", "text");
  selectors.repCode.dataset.lpignore = "true";
}

if (selectors.email) {
  selectors.email.setAttribute("autocomplete", "email");
  selectors.email.setAttribute("inputmode", "email");
  selectors.email.setAttribute("spellcheck", "false");
}

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

let latestPricing = null;

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

function calculatePricing() {
  const basePrice = 20;
  const tierValue = selectors.serviceTier.value;
  const isGold = tierValue === "gold";
  const tierMultiplier = isGold ? 1.35 : 1;
  const sizeMultiplier = {
    "2 bed": 1,
    "3 bed": 1.2,
    "4 bed": 1.5,
    "5 bed": 1.8,
    "6 bed": 2,
  }[selectors.houseSize.value] || 1;

  const extras =
    (selectors.conservatory.checked ? 8 : 0) +
    (selectors.extension.checked ? 6 : 0);

  const lanterns = clamp(Number(selectors.roofLanterns.value) || 0, 0, 50);
  const skylights = clamp(Number(selectors.skylights.value) || 0, 0, 50);

  let pricePerClean =
    (basePrice * tierMultiplier * sizeMultiplier +
      lanterns * 10 +
      skylights * 1.5 +
      extras) * 1;

  if (selectors.alternating.checked) {
    pricePerClean *= 0.5;
  }
  if (!selectors.addVAT || selectors.addVAT.type === "hidden" || selectors.addVAT.checked || selectors.addVAT.value === "true") {
    pricePerClean *= 1.2;
  }

  pricePerClean = Math.max(pricePerClean, 16);

  return {
    pricePerClean: Number(pricePerClean.toFixed(2)),
    priceUpfront: Number((pricePerClean * 3).toFixed(2)),
  };
}

function renderPricing(pricing) {
  latestPricing = pricing;
  const html = `
    <p class="price-main"><strong>Price per clean:</strong> ${formatCurrency(pricing.pricePerClean)}</p>
  `;
  if (selectors.resultContent) {
    selectors.resultContent.innerHTML = html;
  } else if (selectors.resultPanel) {
    // Fallback if content container isn't present
    selectors.resultPanel.innerHTML = html;
  }
  if (selectors.resultPanel) selectors.resultPanel.hidden = false;
  if (selectors.customerSection) selectors.customerSection.hidden = false;
}

function updateTierCopy() {
  const tierKey = selectors.serviceTier.value;
  const copy = tierDetails[tierKey] || "";
  selectors.tierDescription.textContent = copy;
}

async function sendQuoteEmail(
  quote,
  { statusPanel = selectors.resultPanel, silent = false } = {},
) {
  if (!window.emailjs || !emailjs.send) return true;

  const planLabel = quote.tier === "gold" ? "Gold" : "Silver";
  const extrasLabel = buildExtrasLabel(quote);

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
    await emailjs.send("service_cdy739m", "template_rqdf3xf", {
      customer_name: quote.customerName,
      house_size: quote.houseSize,
      house_type: quote.houseType,
      extras: extrasLabel || "Standard clean",
      skylights: String(quote.skylights || 0),
      address: quote.address,
      plan: planLabel,
      price_per_clean: quote.pricePerClean.toFixed(2),
      amount: quote.price.toFixed(2),
      ref_code: quote.refCode,
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

  const subject = "Your Quote - Swash Cleaning Ltd - Payment Details";
  const planLabel = quote.tier === "gold" ? "Gold" : "Silver";
  const extrasLabel = buildExtrasLabel(quote);

  selectors.emailPreviewSubject.textContent = subject;

  const html = `
    <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); overflow: hidden;">
      <div style="background: #007bff; padding: 15px 0px; text-align: center;">
        <img style="max-width: 120px; height: auto;" src="https://static.wixstatic.com/media/8d161e_3f05bebd4d0a48b785070adc8ec12a0c~mv2.png" alt="Swash Logo">
      </div>
      <div style="padding: 25px;">
        <h2 style="color: #007bff; text-align: center; margin-top: 0;">Welcome To Swash</h2>
        <hr style="border: none; border-top: 1px dotted #bbb; margin: 15px 0;">
        <p style="line-height: 1.6;">Hi <strong>${escapeHtml(quote.customerName)}</strong>, your <strong>${escapeHtml(
    quote.houseSize,
  )} ${escapeHtml(quote.houseType)}</strong> with <strong>${escapeHtml(
    extrasLabel || "Standard clean",
  )}</strong> and <strong>${escapeHtml(
    String(quote.skylights || 0),
  )}</strong> skylight(s) will all be cleaned soon at <strong>${escapeHtml(quote.address)}</strong>.</p>
        <p>You are on our <strong>${escapeHtml(
          planLabel,
        )}</strong> plan, and the price per clean every 4 weeks is <strong>&pound;${escapeHtml(
          quote.pricePerClean.toFixed(2),
        )}</strong>.</p>
        <hr style="border: none; border-top: 1px dotted #bbb; margin: 15px 0;">
        <p>We collect payments for 3 cleans in advance. This helps reduce admin and ensures we can focus on providing great service.</p>
        <p><strong>Amount:</strong> &pound;${escapeHtml(
          quote.price.toFixed(2),
        )} &nbsp;&nbsp; <strong>Ref:</strong> ${escapeHtml(
    quote.refCode,
  )}<br><strong>Business Acc Name:</strong> SWASH CLEANING LTD<br><strong>Account Number:</strong> 65069359<br><strong>Sort Code:</strong> 23-01-20</p>
        <div style="text-align: center; margin: 25px 0;">
          <a style="display: inline-block; background: #007BFF; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;" href="https://pay.gocardless.com/BRT0003TYR78S17"> Set Up Direct Debit </a>
        </div>
        <p style="text-align: center; margin-top: 25px; font-size: 15px;">Many thanks,<br><strong>Swash Cleaning Ltd</strong></p>
      </div>
    </div>
  `;

  selectors.emailPreviewBody.innerHTML = html;
  selectors.emailPreviewCard.hidden = false;
}

async function persistQuote(quote) {
  try {
    await addDoc(collection(db, "quotes"), {
      ...quote,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error("Firestore write failed", error);
    if (error.code === 'unavailable' || error.code === 'failed-precondition') {
      console.warn("Network unavailable");
      return false;
    }
    throw error;
  }
}

function validateCustomerFields() {
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
  if (!validateCustomerFields()) return;

  const pricing = latestPricing || calculatePricing();
  if (!latestPricing) {
    renderPricing(pricing);
  }
  selectors.resultPanel
    .querySelectorAll(".status")
    .forEach((node) => node.remove());

  const repCodeValue = selectors.repCode.value.trim() || "Website Quote";
  selectors.repCode.value = repCodeValue;

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
    alternating: selectors.alternating.checked,
    pricePerClean: pricing.pricePerClean,
    price: pricing.priceUpfront,
    refCode: generateReference(),
    status: "Pending Payment",
    notes: selectors.notes.value.trim(),
  };

  let storedOnline = false;
  try {
    storedOnline = await persistQuote(quote);
  } catch (error) {
    console.error("Failed to save quote", error);
    storedOnline = false;
  }

  selectors.paymentRefValue.textContent = quote.refCode;
  selectors.paymentRefBox.hidden = false;

  let emailSent = false;
  if (storedOnline && navigator.onLine) {
    emailSent = await sendQuoteEmail(quote);
  }
  renderEmailPreview(quote);

  if (emailSent) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status success">Quote emailed to <strong>${escapeHtml(emailValue)}</strong>. Preview below.</p>`,
    );
  } else if (storedOnline) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status warning">Quote saved to dashboard. Email will need to be sent manually.</p>`,
    );
  }

  if (!storedOnline) {
    selectors.resultPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="status warning">Could not save quote at this time. Please try again later.</p>`,
    );
  }
}

function registerEvents() {
  const syncSlider = (input, output) => {
    if (!input || !output) return;
    output.textContent = input.value;
    input.addEventListener("input", () => {
      output.textContent = input.value;
    });
  };

  syncSlider(selectors.roofLanterns, selectors.roofLanternsValue);
  syncSlider(selectors.skylights, selectors.skylightsValue);

  // Auto-update on changes
  selectors.serviceTier.addEventListener("change", () => {
    updateTierCopy();
    renderPricing(calculatePricing());
  });
  selectors.houseType?.addEventListener("change", () => renderPricing(calculatePricing()));
  selectors.houseSize?.addEventListener("change", () => renderPricing(calculatePricing()));
  selectors.conservatory?.addEventListener("change", () => renderPricing(calculatePricing()));
  selectors.extension?.addEventListener("change", () => renderPricing(calculatePricing()));
  selectors.alternating?.addEventListener("change", () => renderPricing(calculatePricing()));

  selectors.submitBtn.addEventListener("click", handleSubmit);

  // Apply special offer: set tier to Gold For Silver and recalc
  if (selectors.applyOfferBtn) {
    selectors.applyOfferBtn.addEventListener("click", () => {
      if (!selectors.serviceTier) return;
      selectors.serviceTier.value = "gold-for-silver";
      selectors.serviceTier.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

function initEmailJs() {
  if (window.emailjs && emailjs.init) {
    emailjs.init("7HZRYXz3JmMciex1L");
  }
}

async function initApp() {
  initEmailJs();
  registerEvents();
  updateTierCopy();
  selectors.quoteDate.value = new Date().toLocaleDateString("en-GB");
  // Initial calc and show result box immediately
  renderPricing(calculatePricing());
  if (selectors.addVAT) {
    selectors.addVAT.value = "true";
    if (selectors.addVAT.type === "checkbox") {
      selectors.addVAT.checked = true;
      selectors.addVAT.disabled = true;
    }
  }
}

function startCalculator() {
  initApp().catch((error) => console.error("Init failed", error));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startCalculator);
} else {
  startCalculator();
}
