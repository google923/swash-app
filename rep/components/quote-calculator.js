import { auth, db } from "../../firebase-init.js";
import { logOutboundEmailToFirestore } from "../../lib/firestore-utils.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getFirestore,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { queueOfflineSubmission, syncQueue, getQueue, removeFromQueue } from "../../offline-queue.js";

export function createLegacyQuoteCalculator(options = {}) {
  const {
    container,
    onQuoteCompleted,
    onStatus,
    prefillAddress,
    repPrefill,
    mode = "modal",
  } = options;

  if (!container) {
    throw new Error("Quote calculator requires a container element");
  }

  const frame = document.createElement("div");
  frame.className = "quote-modal-shell";
  frame.classList.toggle("embed-mode", true);
  frame.innerHTML = buildTemplate();
  container.appendChild(frame);

  const elements = mapSelectors(frame);
  hydratePrefill(elements, { address: prefillAddress, repCode: repPrefill });
  const controller = buildController({ elements, onQuoteCompleted, onStatus, mode });
  controller.bootstrap();
  return controller;
}

function buildTemplate() {
  return `
    <div class="page">
      <section class="card">
        <header class="card-header">
          <h2>Add Customer</h2>
          <p id="tierDescription">Select a service tier to see the details.</p>
        </header>
        <section id="customerFields" class="customer-section customer-box" hidden>
          <h3>Customer Details</h3>
          <div class="form-grid">
            <label for="customerName">Full Name</label>
            <input id="customerName" autocomplete="name" required />
            <label for="address">Address</label>
            <input id="address" autocomplete="street-address" required />
            <label for="mobile">Mobile</label>
            <input id="mobile" autocomplete="tel" required />
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" required />
          </div>
        </section>
        <form id="quoteForm" class="form-grid" autocomplete="off">
          <label class="form-section" for="repCode" hidden>
            <span>Rep Code</span>
            <input id="repCode" name="repCode" required value="Website Quote" />
          </label>
          <label class="form-section" for="quoteDate" hidden>
            <span>Quote Date</span>
            <input id="quoteDate" name="quoteDate" readonly />
          </label>
          <div class="options-box">
            <div class="form-grid">
              <label class="form-section" for="serviceTier">
                <span>Service Tier</span>
                <select id="serviceTier" name="serviceTier">
                  <option value="gold" selected>Gold</option>
                  <option value="silver">Silver</option>
                </select>
              </label>
              <div class="inline-two">
                <label class="form-section" for="houseSize">
                  <span>House Size</span>
                  <select id="houseSize" name="houseSize">
                    <option>2 bed</option>
                    <option>3 bed</option>
                    <option>4 bed</option>
                    <option>5 bed</option>
                    <option>6 bed</option>
                  </select>
                </label>
                <label class="form-section" for="houseType">
                  <span>House Type</span>
                  <select id="houseType" name="houseType">
                    <option value="Bungalow">Bungalow</option>
                    <option value="Maisonette">Maisonette</option>
                    <option value="Terrace">Terrace</option>
                    <option value="Semi-Detached">Semi-Detached</option>
                    <option value="Detached">Detached</option>
                    <option value="Mobile Home">Mobile Home</option>
                  </select>
                </label>
              </div>
              <div class="inline-two inline-two--mobile-2">
                <label class="form-section checkbox checkbox--lg" for="conservatory">
                  <input type="checkbox" id="conservatory" />
                  <span>Conservatory</span>
                </label>
                <label class="form-section checkbox checkbox--lg" for="extension">
                  <input type="checkbox" id="extension" />
                  <span>Extension</span>
                </label>
              </div>
              <label class="form-section" for="roofLanterns">
                <span>Roof Lanterns</span>
                <div class="slider-row">
                  <input type="range" id="roofLanterns" min="0" max="10" value="0" step="1" />
                  <span class="slider-value" id="roofLanternsValue">0</span>
                </div>
              </label>
              <label class="form-section" for="skylights">
                <span>Skylights</span>
                <div class="slider-row">
                  <input type="range" id="skylights" min="0" max="10" value="0" step="1" />
                  <span class="slider-value" id="skylightsValue">0</span>
                </div>
              </label>
              <input type="hidden" id="partialCleaning" value="100" />
              <input type="hidden" id="addVAT" value="true" />
              <label class="form-section" for="notes">
                <span>Notes</span>
                <textarea id="notes" rows="3" placeholder="Add any customer notes or access information..."></textarea>
              </label>
              <div class="map-optin">
                <label class="map-optin__label" for="setLocation">
                  <input type="checkbox" id="setLocation" />
                  📍 Set Customer Location
                </label>
                <p class="map-optin__hint">Click the button below to set the customer location on a map.</p>
              </div>
              <div>
                <button type="button" id="setLocationBtn" class="btn btn-secondary" style="width: 100%;">📍 Set Location on Map</button>
              </div>
              <input type="hidden" id="customerLatitude" />
              <input type="hidden" id="customerLongitude" />
            </div>
          </div>
        </form>
        <section id="result" class="result-panel" aria-live="polite"></section>
        <div class="form-actions form-actions--end form-actions--compact">
          <label class="checkbox checkbox--lg" for="alternating">
            <input type="checkbox" id="alternating" />
            <span>Alternating Clean</span>
          </label>
          <button type="button" id="applyOfferBtn" class="btn btn-offer">Apply Special Offer</button>
        </div>
        <div class="form-actions form-actions--end">
          <button type="button" id="submitBtn" class="btn btn-primary">Schedule First Clean</button>
        </div>
        <aside id="paymentRefBox" class="payment-ref" hidden>
          <p><strong>Payment Reference:</strong> <span id="paymentRefValue"></span></p>
        </aside>
        <section id="emailPreviewCard" class="email-preview-card" hidden>
          <div class="email-preview-header">
            <h3>Email Preview</h3>
            <p id="emailPreviewSubject" class="email-preview-subject"></p>
          </div>
          <div id="emailPreviewBody" class="email-preview-body"></div>
        </section>
        <section id="queueAlerts" class="queue-alerts" hidden aria-live="polite"></section>
      </section>
    </div>
    <div id="setCustomerLocationModal" hidden class="location-modal"></div>
  `;
}

function mapSelectors(root) {
  const query = (id) => root.querySelector(`#${id}`);
  return {
    root,
    repCode: query("repCode"),
    quoteDate: query("quoteDate"),
    serviceTier: query("serviceTier"),
    tierDescription: query("tierDescription"),
    houseType: query("houseType"),
    houseSize: query("houseSize"),
    conservatory: query("conservatory"),
    extension: query("extension"),
    roofLanterns: query("roofLanterns"),
    roofLanternsValue: query("roofLanternsValue"),
    skylights: query("skylights"),
    skylightsValue: query("skylightsValue"),
    partialCleaning: query("partialCleaning"),
    alternating: query("alternating"),
    addVAT: query("addVAT"),
    notes: query("notes"),
    applyOfferBtn: query("applyOfferBtn"),
    submitBtn: query("submitBtn"),
    resultPanel: query("result"),
    customerSection: query("customerFields"),
    customerName: query("customerName"),
    address: query("address"),
    mobile: query("mobile"),
    email: query("email"),
    paymentRefBox: query("paymentRefBox"),
    paymentRefValue: query("paymentRefValue"),
    emailPreviewCard: query("emailPreviewCard"),
    emailPreviewSubject: query("emailPreviewSubject"),
    emailPreviewBody: query("emailPreviewBody"),
    queueAlerts: query("queueAlerts"),
    form: query("quoteForm"),
    setLocation: query("setLocation"),
    setLocationBtn: query("setLocationBtn"),
    customerLatitude: query("customerLatitude"),
    customerLongitude: query("customerLongitude"),
    locationModal: root.querySelector("#setCustomerLocationModal"),
  };
}

function hydratePrefill(elements, { address, repCode }) {
  if (address && elements.address) {
    elements.address.value = address;
  }
  if (repCode && elements.repCode) {
    elements.repCode.value = repCode;
  }
}

function buildController({ elements, onQuoteCompleted, onStatus, mode }) {
  const state = {
    latestPricing: null,
    offerApplied: false,
    offerExpiresAt: null,
    messageTouched: false,
  };

  function emitStatus(type, payload = {}) {
    if (typeof onStatus === "function") {
      onStatus({ type, ...payload });
    }
  }

  function emitCompleted(details) {
    if (typeof onQuoteCompleted === "function") {
      onQuoteCompleted(details);
    }
  }

  const selectors = elements;
  const controller = {
    async bootstrap() {
      initSelectors();
      initEvents();
      renderPricing();
      updateTierCopy();
      selectors.customerSection.hidden = false;
      if (selectors.addVAT) selectors.addVAT.value = "true";
      syncQueue();
    },
    destroy() {
      selectors.root.remove();
    },
    getState() {
      return state;
    },
  };

  function initSelectors() {
    selectors.repCode?.setAttribute("autocomplete", "off");
    selectors.repCode?.setAttribute("autocorrect", "off");
    selectors.repCode?.setAttribute("autocapitalize", "off");
    selectors.repCode?.setAttribute("spellcheck", "false");
    selectors.email?.setAttribute("autocomplete", "email");
    selectors.email?.setAttribute("inputmode", "email");
    const today = new Date();
    if (selectors.quoteDate) selectors.quoteDate.value = today.toLocaleDateString("en-GB");
  }

  function initEvents() {
    const controls = [
      selectors.serviceTier,
      selectors.houseType,
      selectors.houseSize,
      selectors.conservatory,
      selectors.extension,
      selectors.roofLanterns,
      selectors.skylights,
      selectors.alternating,
    ];
    controls.forEach((control) => control?.addEventListener("input", () => renderPricing()));
    selectors.applyOfferBtn?.addEventListener("click", () => toggleOffer());
    selectors.submitBtn?.addEventListener("click", () => handleSubmit());
    window.addEventListener("swashQueueUpdated", renderOfflineQueue);
    window.addEventListener("swashQueueSynced", handleQueueSynced);
  }

  function renderPricing() {
    const pricing = calculatePricing();
    state.latestPricing = pricing;
    const resultPanel = selectors.resultPanel;
    if (!resultPanel) return;
    const box = ensureResultBox(resultPanel);
    box.innerHTML = buildPricePanelMarkup(pricing);
    resultPanel.hidden = false;
  }

  function ensureResultBox(panel) {
    let box = panel.querySelector(".result-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "result-box";
      panel.insertBefore(box, panel.firstChild);
    }
    return box;
  }

  function toggleOffer() {
    if (!selectors.serviceTier || selectors.serviceTier.value !== "gold") {
      alert("Special Offer applies to Gold tier only. Please select Gold first.");
      selectors.serviceTier?.focus();
      return;
    }
    state.offerApplied = !state.offerApplied;
    state.offerExpiresAt = state.offerApplied ? computeOfferExpiryIso() : null;
    renderPricing();
  }

  function calculatePricing() {
    const priceTableBase = {
      "2 bed": { semi: { silver: { base: 16, ext: 20, cons: 23, both: 26 } }, detached: { silver: { base: 19, ext: 23, cons: 26, both: 29 } } },
      "3 bed": { semi: { silver: { base: 21, ext: 25, cons: 28, both: 31 } }, detached: { silver: { base: 24, ext: 28, cons: 31, both: 34 } } },
      "4 bed": { semi: { silver: { base: 26, ext: 30, cons: 33, both: 36 } }, detached: { silver: { base: 29, ext: 33, cons: 36, both: 39 } } },
      "5 bed": { semi: { silver: { base: 31, ext: 35, cons: 38, both: 41 } }, detached: { silver: { base: 34, ext: 38, cons: 41, both: 44 } } },
      "6 bed": { semi: { silver: { base: 36, ext: 40, cons: 43, both: 46 } }, detached: { silver: { base: 39, ext: 43, cons: 46, both: 49 } } },
    };
    const MIN_NET_PRICE = 16;
    const GOLD_FACTOR = 1.35;
    const ROOF_LANTERN_ADDON = 10;
    const VELUX_ADDON_EACH = 1.5;
    const tier = selectors.serviceTier?.value || "silver";
    const houseType = selectors.houseType?.value || "Semi-Detached";
    const houseSize = selectors.houseSize?.value || "2 bed";
    const conservatory = selectors.conservatory?.checked || false;
    const extension = selectors.extension?.checked || false;
    const lanterns = Number(selectors.roofLanterns?.value || 0);
    const skylights = Number(selectors.skylights?.value || 0);
    const alternating = selectors.alternating?.checked || false;
    const houseKey = houseType.toLowerCase().includes("detached") ? "detached" : "semi";
    const row = priceTableBase[houseSize]?.[houseKey]?.silver;
    let price = row ? row.base : MIN_NET_PRICE;
    if (extension && conservatory) price = row ? row.both : price;
    else if (extension) price = row ? row.ext : price;
    else if (conservatory) price = row ? row.cons : price;
    price += lanterns * ROOF_LANTERN_ADDON;
    price += skylights * VELUX_ADDON_EACH;
    if (alternating) price /= 2;
    if (tier === "gold" && !state.offerApplied) price *= GOLD_FACTOR;
    price = Math.max(price, MIN_NET_PRICE);
    return {
      pricePerClean: Number(price.toFixed(2)),
      priceUpfront: Number((price * 3).toFixed(2)),
    };
  }

  async function handleSubmit() {
    if (!validateCustomerFields()) {
      emitStatus("error", { message: "Please complete customer details." });
      return;
    }
    if (!selectors.customerLatitude?.value || !selectors.customerLongitude?.value) {
      emitStatus("error", { message: "Please set the customer location before saving the quote." });
      return;
    }
    const pricing = state.latestPricing || calculatePricing();
    const quote = buildQuotePayload(pricing);
    const persisted = await persistQuote(quote);
    if (!persisted) {
      queueOfflineSubmission(quote);
      emitStatus("queued", { quote });
    } else {
      emitStatus("saved", { quote });
      await sendQuoteEmail(quote);
    }
    emitCompleted(quote);
    resetForm();
  }

  function validateCustomerFields() {
    const required = [selectors.customerName, selectors.address, selectors.mobile, selectors.email];
    for (const field of required) {
      if (!field?.value?.trim()) {
        field?.focus();
        field?.reportValidity?.();
        return false;
      }
    }
    return true;
  }

  function buildQuotePayload(pricing) {
    return {
      repCode: selectors.repCode?.value?.trim() || "Website Quote",
      date: new Date().toISOString(),
      customerName: selectors.customerName?.value?.trim() || "",
      address: selectors.address?.value?.trim() || "",
      mobile: selectors.mobile?.value?.trim() || "",
      email: selectors.email?.value?.trim()?.toLowerCase() || "",
      tier: selectors.serviceTier?.value || "silver",
      houseType: selectors.houseType?.value || "Semi-Detached",
      houseSize: selectors.houseSize?.value || "2 bed",
      extension: selectors.extension?.checked || false,
      conservatory: selectors.conservatory?.checked || false,
      skylights: Number(selectors.skylights?.value || 0),
      roofLanterns: Number(selectors.roofLanterns?.value || 0),
      alternating: selectors.alternating?.checked || false,
      pricePerClean: pricing.pricePerClean,
      price: pricing.priceUpfront,
      refCode: generateReference(),
      status: "Pending Booking",
      notes: selectors.notes?.value?.trim() || "",
      customerLatitude: selectors.customerLatitude?.value ? Number(selectors.customerLatitude.value) : null,
      customerLongitude: selectors.customerLongitude?.value ? Number(selectors.customerLongitude.value) : null,
      offerApplied: state.offerApplied,
      offerType: state.offerApplied ? "gold-for-silver" : null,
      offerExpiresAt: state.offerExpiresAt,
    };
  }

  async function persistQuote(quote) {
    try {
      const docRef = await addDoc(collection(db, "quotes"), {
        ...quote,
        createdAt: serverTimestamp(),
      });
      if (docRef?.id) quote.id = docRef.id;
      return true;
    } catch (error) {
      if (error.code === "unavailable" || error.code === "failed-precondition") {
        return false;
      }
      emitStatus("error", { message: "Permission denied or invalid session" });
      return false;
    }
  }

  async function sendQuoteEmail(quote) {
    if (!window.emailjs || !emailjs.send) return true;
    const recipient = quote.email;
    if (!recipient) return false;
    const message = buildEmailMessage(quote);
    try {
      await emailjs.send("service_cdy739m", "template_6mpufs4", {
        customer_name: quote.customerName,
        title: "Your Swash Window Cleaning Quote",
        message,
        message_body: message,
        email: recipient,
      });
      await logOutboundEmailToFirestore({
        to: recipient,
        subject: "Your Swash Window Cleaning Quote",
        body: message,
        source: "quote-calculator-modal",
      });
      emitStatus("email-sent", { quote });
      return true;
    } catch (error) {
      emitStatus("email-failed", { quote, error });
      return false;
    }
  }

  function buildEmailMessage(quote) {
    return `Hi ${quote.customerName || 'there'},\n\nThank you for choosing Swash Window Cleaning. A member of our team will contact you soon to book your first clean in.\n\nBest regards,\nThe Swash Team`;
  }

  function resetForm() {
    selectors.form?.reset();
    state.offerApplied = false;
    state.offerExpiresAt = null;
    renderPricing();
  }

  function renderOfflineQueue() {
    const queuePanel = selectors.queueAlerts;
    if (!queuePanel) return;
    const queue = getQueue();
    if (!queue.length) {
      queuePanel.hidden = true;
      queuePanel.innerHTML = "";
      return;
    }
    queuePanel.hidden = false;
    queuePanel.innerHTML = queue
      .map((item) => `
        <div class="queue-item">
          <span>Quote for ${item.customerName || item.address || item.refCode} pending.</span>
          <button type="button" data-ref="${item.refCode}" class="btn btn-secondary queue-send">Send now</button>
        </div>
      `)
      .join("");
    queuePanel.addEventListener("click", (event) => {
      const button = event.target.closest(".queue-send");
      if (!button) return;
      handleSendQueuedQuote(button.dataset.ref);
    });
  }

  async function handleSendQueuedQuote(refCode) {
    const queue = getQueue();
    const quote = queue.find((item) => item.refCode === refCode);
    if (!quote) return;
    if (!navigator.onLine) {
      emitStatus("error", { message: "Offline. Connect before sending queued quotes." });
      return;
    }
    const { emailPending, queuedAt, ...payload } = quote;
    const storedOnline = await persistQuote(payload);
    if (!storedOnline) {
      emitStatus("error", { message: "Quote could not be saved yet. Try again later." });
      return;
    }
    const emailSent = await sendQuoteEmail(payload);
    if (!emailSent) {
      emitStatus("error", { message: "Quote saved but email failed. Retry later." });
      return;
    }
    removeFromQueue(refCode);
    renderOfflineQueue();
    emitStatus("queue-sent", { quote: payload });
  }

  function handleQueueSynced(event) {
    const quote = event.detail?.quote;
    if (!quote || !navigator.onLine) return;
    sendQuoteEmail(quote);
  }

  return controller;
}

/* -------------------------------------------------------------------------- */
/* Embedded quote calculator (modal version)                                  */
/* -------------------------------------------------------------------------- */
const EMBED_EMAIL_SERVICE_ID = "service_cdy739m";
const EMBED_EMAIL_TEMPLATE_ID = "template_d8tlf1p";
const EMBED_EMAIL_PUBLIC_KEY = "7HZRYXz3JmMciex1L";
const EMBED_GOOGLE_MAPS_SRC =
  "https://maps.googleapis.com/maps/api/js?key=AIzaSyCcI3UKTFSa-J3t3C3eebXr5tpDFqIznpI&libraries=geometry,places";

const EMBED_PRICE_TABLE = {
  "2 bed": { semi: { silver: { base: 16, ext: 20, cons: 23, both: 26 } }, detached: { silver: { base: 19, ext: 23, cons: 26, both: 29 } } },
  "3 bed": { semi: { silver: { base: 21, ext: 25, cons: 28, both: 31 } }, detached: { silver: { base: 24, ext: 28, cons: 31, both: 34 } } },
  "4 bed": { semi: { silver: { base: 26, ext: 30, cons: 33, both: 36 } }, detached: { silver: { base: 29, ext: 33, cons: 36, both: 39 } } },
  "5 bed": { semi: { silver: { base: 31, ext: 35, cons: 38, both: 41 } }, detached: { silver: { base: 34, ext: 38, cons: 41, both: 44 } } },
  "6 bed": { semi: { silver: { base: 36, ext: 40, cons: 43, both: 46 } }, detached: { silver: { base: 39, ext: 43, cons: 46, both: 49 } } },
};

const EMBED_MIN_PRICE = 16;
const EMBED_GOLD_FACTOR = 1.35;
const EMBED_ROOF_LANTERN_ADDON = 10;
const EMBED_SKYLIGHT_ADDON = 1.5;
const EMBED_HOUSE_TYPE_BAND_MAP = {
  semi: "semi",
  "semi-detached": "semi",
  terrace: "semi",
  terraced: "semi",
  maisonette: "semi",
  bungalow: "semi",
  detached: "detached",
  caravan: "detached",
  "mobile home": "detached",
  house: "detached",
};
const EMBED_HOUSE_TYPE_MULT = {
  caravan: 0.9,
  "mobile home": 0.9,
  bungalow: 0.9,
  maisonette: 0.94,
  terrace: 0.97,
  terraced: 0.97,
  semi: 1.0,
  "semi-detached": 1.0,
  detached: 1.05,
  house: 1.05,
};

function normalizeEmbedSize(value) {
  const v = String(value).toLowerCase();
  if (v.includes("6") && v.includes("bed")) return "6 bed";
  if (v.includes("5") && v.includes("bed")) return "5 bed";
  if (v.includes("4") && v.includes("bed")) return "4 bed";
  if (v.includes("3") && v.includes("bed")) return "3 bed";
  return "2 bed";
}

function normalizeEmbedHouseTypeKey(value) {
  const v = String(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (v.includes("bungalow")) return "bungalow";
  if (v.includes("mobile")) return "mobile home";
  if (v.includes("caravan")) return "caravan";
  if (v.includes("maisonette")) return "maisonette";
  if (v.includes("terrace")) return "terrace";
  if (v.includes("semi")) return "semi";
  if (v.includes("detached")) return "detached";
  if (v.includes("house")) return "house";
  return "semi";
}

function getEmbedBandAndMult(houseType) {
  const key = normalizeEmbedHouseTypeKey(houseType);
  return {
    band: EMBED_HOUSE_TYPE_BAND_MAP[key] || "semi",
    mult: EMBED_HOUSE_TYPE_MULT[key] ?? 1,
  };
}

let embedMapsPromise = null;
let embedEmailJsPromise = null;

export function createQuoteCalculator(options = {}) {
  return new QuoteCalculatorEmbed(options);
}

class QuoteCalculatorEmbed {
  constructor(options) {
    if (!options?.container) throw new Error("Quote calculator requires a container element");
    this.container = options.container;
    this.mode = options.mode || "embed";
    this.onStatus = typeof options.onStatus === "function" ? options.onStatus : null;
    this.onQuoteCompleted =
      typeof options.onQuoteCompleted === "function" ? options.onQuoteCompleted : null;
    this.prefillAddress = options.prefillAddress || "";
    this.repPrefill = options.repPrefill || "";
    this.state = {
      latestPricing: null,
      offerApplied: false,
      offerExpiresAt: null,
      latestSummary: "",
    };
    this.cleanupFns = [];
    this.render();
    this.cacheSelectors();
    this.bootstrap();
  }

  render() {
    this.container.innerHTML = buildEmbedTemplate();
    this.root = this.container.querySelector(".quote-modal-shell");
    if (this.mode === "embed") {
      this.root.classList.add("embed-mode");
    }
  }

  cacheSelectors() {
    const query = (id) => this.root.querySelector(`#${id}`);
    this.q = {
      repCode: query("repCode"),
      quoteDate: query("quoteDate"),
      serviceTier: query("serviceTier"),
      tierDescription: query("tierDescription"),
      houseType: query("houseType"),
      houseSize: query("houseSize"),
      conservatory: query("conservatory"),
      extension: query("extension"),
      roofLanterns: query("roofLanterns"),
      roofLanternsValue: query("roofLanternsValue"),
      skylights: query("skylights"),
      skylightsValue: query("skylightsValue"),
      alternating: query("alternating"),
  frontOnly: query("frontOnly"),
  partialCleaning: query("partialCleaning"),
      notes: query("notes"),
      form: query("quoteForm"),
      resultPanel: query("result"),
      applyOfferBtn: query("applyOfferBtn"),
      submitBtn: query("submitBtn"),
      customerSection: query("customerFields"),
      customerName: query("customerName"),
      address: query("address"),
      mobile: query("mobile"),
      email: query("email"),
      paymentRefBox: query("paymentRefBox"),
      paymentRefValue: query("paymentRefValue"),
      emailPreviewCard: query("emailPreviewCard"),
      emailPreviewSubject: query("emailPreviewSubject"),
      emailPreviewBody: query("emailPreviewBody"),
      queueAlerts: query("queueAlerts"),
      customerLatitude: query("customerLatitude"),
      customerLongitude: query("customerLongitude"),
      setLocationBtn: query("setLocationBtn"),
      locationModal: query("setCustomerLocationModal"),
      locationAddressDisplay: query("locationAddressDisplay"),
      locationMapCanvas: query("locationMap"),
      locationLatInput: query("locationLatInput"),
      locationLngInput: query("locationLngInput"),
      saveLocationBtn: query("saveLocationBtn"),
      cancelLocationBtn: query("cancelLocationBtn"),
      closeLocationModalBtn: query("closeLocationModal"),
      useCurrentLocationBtn: query("useCurrentLocation"),
      locationGpsStatus: query("locationGpsStatus"),
    };
  }

  bootstrap() {
    this.prepareStaticFields();
    this.registerEvents();
    this.renderPricing();
    this.initAuthPrefill();
    this.renderOfflineQueue();
    syncQueue();
    if (this.prefillAddress) this.setAddressLine(this.prefillAddress);
    if (this.repPrefill) this.setRepCode(this.repPrefill);
    this.emitStatus("ready");
  }

  prepareStaticFields() {
    if (this.q.repCode) this.q.repCode.readOnly = true;
    if (this.q.email) {
      this.q.email.setAttribute("autocomplete", "email");
      this.q.email.setAttribute("inputmode", "email");
    }
    if (this.q.customerSection) this.q.customerSection.hidden = false;
    if (this.q.quoteDate)
      this.q.quoteDate.value = new Date().toLocaleDateString("en-GB");
  }

  registerEvents() {
    const reactToChange = () => this.renderPricing();
    [
      this.q.serviceTier,
      this.q.houseType,
      this.q.houseSize,
      this.q.conservatory,
      this.q.extension,
      this.q.roofLanterns,
      this.q.skylights,
      this.q.alternating,
      this.q.frontOnly,
    ].forEach((el) => el?.addEventListener("input", reactToChange));

    this.q.roofLanterns?.addEventListener("input", () => {
      if (this.q.roofLanternsValue) this.q.roofLanternsValue.textContent = this.q.roofLanterns.value;
    });
    this.q.skylights?.addEventListener("input", () => {
      if (this.q.skylightsValue) this.q.skylightsValue.textContent = this.q.skylights.value;
    });

    this.q.applyOfferBtn?.addEventListener("click", () => this.toggleOffer());
    this.q.submitBtn?.addEventListener("click", () => this.handleSubmit());
    this.q.queueAlerts?.addEventListener("click", (event) => {
      const target = event.target.closest(".queue-send");
      if (target) this.handleSendQueuedQuote(target.dataset.ref);
    });
    this.q.setLocationBtn?.addEventListener("click", () => this.openLocationModal());
    [this.q.locationLatInput, this.q.locationLngInput].forEach((input) =>
      input?.addEventListener("change", () => this.handleManualLocationInput()),
    );
    this.q.saveLocationBtn?.addEventListener("click", () => this.persistLocationFromModal());
    this.q.cancelLocationBtn?.addEventListener("click", () => this.hideLocationModal());
    this.q.closeLocationModalBtn?.addEventListener("click", () => this.hideLocationModal());
    this.q.useCurrentLocationBtn?.addEventListener("click", () =>
      this.requestCurrentPositionForLocationModal(),
    );

    this.handleOnline = () => syncQueue();
    window.addEventListener("online", this.handleOnline);
    this.cleanupFns.push(() => window.removeEventListener("online", this.handleOnline));

    this.handleQueueUpdated = () => this.renderOfflineQueue();
    window.addEventListener("swashQueueUpdated", this.handleQueueUpdated);
    this.cleanupFns.push(() => window.removeEventListener("swashQueueUpdated", this.handleQueueUpdated));

    this.handleQueueSynced = (event) => this.forwardQueueSync(event);
    window.addEventListener("swashQueueSynced", this.handleQueueSynced);
    this.cleanupFns.push(() => window.removeEventListener("swashQueueSynced", this.handleQueueSynced));
  }

  initAuthPrefill() {
    const unsubscribe = onAuthStateChanged(getAuth(), async (user) => {
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? snap.data() : {};
        const repName =
          data.repName || data.displayName || data.name || user.displayName || user.email || "REP";
        this.setRepCode(repName);
      } catch (_) {
        this.setRepCode(user.email || "REP");
      }
    });
    this.cleanupFns.push(() => unsubscribe && unsubscribe());
  }

  setRepCode(value = "") {
    if (this.q.repCode) this.q.repCode.value = value.toString().toUpperCase();
  }

  setAddressLine(value = "") {
    if (this.q.address) this.q.address.value = value;
  }

  beginSession({ addressLine = "", notes = "" } = {}) {
    this.resetForm();
    if (addressLine) this.setAddressLine(addressLine);
    if (notes && this.q.notes) this.q.notes.value = notes;
    this.q.customerName?.focus();
  }

  resetForm() {
    this.q.form?.reset();
    this.state.offerApplied = false;
    this.state.offerExpiresAt = null;
    this.state.latestSummary = "";
    if (this.q.paymentRefBox) this.q.paymentRefBox.hidden = true;
    if (this.q.emailPreviewCard) this.q.emailPreviewCard.hidden = true;
    if (this.q.resultPanel) this.q.resultPanel.innerHTML = "";
    this.renderPricing();
  }

  cancelSession({ silent = false } = {}) {
    this.resetForm();
    if (!silent) this.emitStatus("cancelled");
  }

  destroy() {
    this.cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    this.container.innerHTML = "";
  }

  toggleOffer() {
    if ((this.q.serviceTier?.value || "") !== "gold" && !this.state.offerApplied) {
      alert("Special Offer applies to Gold tier only. Please select Gold first.");
      this.q.serviceTier?.focus();
      return;
    }
    this.state.offerApplied = !this.state.offerApplied;
    this.state.offerExpiresAt = this.state.offerApplied ? computeEmbedOfferExpiryIso() : null;
    if (this.q.applyOfferBtn)
      this.q.applyOfferBtn.textContent = this.state.offerApplied
        ? "Remove Special Offer"
        : "Apply Special Offer";
    this.renderPricing();
  }

  renderPricing() {
    const pricing = this.calculatePricing();
    this.state.latestPricing = pricing;
    if (!this.q.resultPanel) return;
    const offerActive = this.state.offerApplied && this.q.serviceTier?.value === "gold";
    this.q.resultPanel.innerHTML = buildQuotePageResultMarkup(pricing, {
      offerActive,
      expiresAt: this.state.offerExpiresAt,
    });
    this.q.resultPanel.hidden = false;
    if (this.q.customerSection) this.q.customerSection.hidden = false;
  }

  calculatePricing() {
    const tierValue = this.q.serviceTier?.value || "silver";
    const offerActive = this.state.offerApplied && tierValue === "gold";
    const effectiveTier = offerActive ? "silver" : tierValue;
    const houseTypeRaw = this.q.houseType?.value || "Semi-Detached";
    const houseSizeRaw = this.q.houseSize?.value || "2 bed";
    const sizeKey = normalizeEmbedSize(houseSizeRaw);
    const { band, mult } = getEmbedBandAndMult(houseTypeRaw);
    const row = EMBED_PRICE_TABLE[sizeKey]?.[band]?.silver;
    let price = row ? row.base : EMBED_MIN_PRICE;

    const hasExtension = !!this.q.extension?.checked;
    const hasConservatory = !!this.q.conservatory?.checked;
    if (hasExtension && hasConservatory) price = row ? row.both : price;
    else if (hasExtension) price = row ? row.ext : price;
    else if (hasConservatory) price = row ? row.cons : price;

    price *= mult;

    const lanterns = clamp(Number(this.q.roofLanterns?.value) || 0, 0, 50);
    const skylights = clamp(Number(this.q.skylights?.value) || 0, 0, 50);
    price += EMBED_ROOF_LANTERN_ADDON * lanterns;
    price += EMBED_SKYLIGHT_ADDON * skylights;

    const alternating = !!this.q.alternating?.checked;
    const frontOnly = !!this.q.frontOnly?.checked;
    if (alternating || frontOnly) {
      price /= 2;
      if (price < EMBED_MIN_PRICE) price = EMBED_MIN_PRICE;
    }

    if (effectiveTier === "gold") {
      price *= EMBED_GOLD_FACTOR;
    }

    if (price < EMBED_MIN_PRICE) price = EMBED_MIN_PRICE;

    const partial = clamp(Number(this.q.partialCleaning?.value) || 100, 0, 100);
    price *= partial / 100;

    price = Math.max(price, EMBED_MIN_PRICE);

    return {
      pricePerClean: Number(price.toFixed(2)),
      priceUpfront: Number((price * 3).toFixed(2)),
    };
  }

  validateFields() {
    const required = [this.q.customerName, this.q.address, this.q.mobile, this.q.email];
    for (const field of required) {
      if (!field?.value?.trim()) {
        field?.focus();
        field?.reportValidity?.();
        return false;
      }
    }
    const emailValue = normalizeEmail(this.q.email?.value || "");
    if (!emailValue) {
      this.q.email?.focus();
      alert("Please enter a valid email address.");
      return false;
    }
    this.q.email.value = emailValue;
    if (!this.q.customerLatitude?.value || !this.q.customerLongitude?.value) {
      alert("Please set the customer location before sending the quote.");
      return false;
    }
    return true;
  }

  buildQuote(pricing) {
    return {
      repCode: (this.q.repCode?.value || "Website Quote").toUpperCase(),
      date: new Date().toISOString(),
      customerName: this.q.customerName?.value?.trim() || "",
      address: this.q.address?.value?.trim() || "",
      mobile: this.q.mobile?.value?.trim() || "",
      email: normalizeEmail(this.q.email?.value || ""),
      tier: this.q.serviceTier?.value || "silver",
      houseType: this.q.houseType?.value || "Semi-Detached",
      houseSize: this.q.houseSize?.value || "2 bed",
      extension: !!this.q.extension?.checked,
      conservatory: !!this.q.conservatory?.checked,
      skylights: Number(this.q.skylights?.value || 0),
      roofLanterns: Number(this.q.roofLanterns?.value || 0),
      alternating: !!this.q.alternating?.checked,
  frontOnly: !!this.q.frontOnly?.checked,
      notes: this.q.notes?.value?.trim() || "",
      pricePerClean: pricing.pricePerClean,
      price: pricing.priceUpfront,
      refCode: generateEmbedReference(),
      status: "Pending Booking",
      offerApplied: this.state.offerApplied,
      offerType: this.state.offerApplied ? "gold-for-silver" : null,
      offerExpiresAt: this.state.offerExpiresAt,
      customerLatitude: this.q.customerLatitude?.value ? Number(this.q.customerLatitude.value) : null,
      customerLongitude: this.q.customerLongitude?.value
        ? Number(this.q.customerLongitude.value)
        : null,
    };
  }

  showPaymentReference(quote) {
    if (this.q.paymentRefValue) this.q.paymentRefValue.textContent = quote.refCode;
    if (this.q.paymentRefBox) this.q.paymentRefBox.hidden = false;
    this.renderEmailPreview(quote);
  }

  renderEmailPreview(quote) {
    if (!this.q.emailPreviewCard) return;
    const html = buildEmbedEmailMessage(quote).replace(/\n/g, "<br>");
    this.q.emailPreviewSubject.textContent = "Your Swash Window Cleaning Quote";
    this.q.emailPreviewBody.innerHTML = html;
    this.q.emailPreviewCard.hidden = false;
  }

  async handleSubmit() {
    if (!this.validateFields()) return;
    await this.ensureEmailJs();
    const pricing = this.state.latestPricing || this.calculatePricing();
    const quote = this.buildQuote(pricing);
    this.showPaymentReference(quote);

    let storedOnline = false;
    try {
      storedOnline = await this.persistQuote(quote);
    } catch (error) {
      if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
        alert("You're not authorised to submit quotes. Please sign in again.");
        return;
      }
      storedOnline = false;
    }

    if (!storedOnline) {
      queueOfflineSubmission(quote);
      this.renderOfflineQueue();
      this.renderResultStatus("warning", {
        message: "Quote saved offline. We'll sync automatically when you're back online.",
      });
      this.emitSubmissionResult({ storedOnline: false, quote });
      this.resetForm();
      return;
    }

    const emailSent = await this.sendQuoteEmail(quote);
    this.renderResultStatus(emailSent ? "success" : "warning", {
      message: emailSent
        ? `Quote emailed to ${escapeHtml(quote.email)} and saved to dashboard.`
        : "Quote saved but email failed. Please resend later.",
    });
    this.emitSubmissionResult({ storedOnline: true, emailSent, quote });
    this.resetForm();
  }

  renderResultStatus(kind, { message }) {
    if (!this.q.resultPanel) return;
    this.q.resultPanel.innerHTML = `<div class="status ${kind}">${escapeHtml(message || "")}</div>`;
  }

  emitSubmissionResult({ storedOnline, emailSent = false, quote }) {
    const summary = buildEmbedSummary(quote, { storedOnline, emailSent });
    this.state.latestSummary = summary;
    if (storedOnline) this.emitStatus("submitted_online", { quote, summary });
    else this.emitStatus("submitted_offline", { quote, summary });
    if (this.onQuoteCompleted) {
      this.onQuoteCompleted({ quote, summary, storedOnline, emailSent });
    }
  }

  async persistQuote(quote) {
    try {
      const docRef = await addDoc(collection(db, "quotes"), {
        ...quote,
        createdAt: serverTimestamp(),
      });
      if (docRef?.id) quote.id = docRef.id;
      return true;
    } catch (error) {
      if (error?.code === "unavailable" || error?.code === "failed-precondition") {
        return false;
      }
      throw error;
    }
  }

  async sendQuoteEmail(quote, { silent = false } = {}) {
    const welcomeMessage = `Hi ${quote.customerName || 'there'},\n\nThank you for choosing Swash Window Cleaning. A member of our team will contact you soon to book your first clean in.\n\nBest regards,\nThe Swash Team`;
    try {
      await window.emailjs?.send(
        EMBED_EMAIL_SERVICE_ID,
        "template_6mpufs4",
        {
          customer_name: quote.customerName,
          title: "Welcome to Swash Window Cleaning",
          message_body: welcomeMessage,
          email: quote.email,
        },
      );
      await logOutboundEmailToFirestore({
        to: quote.email,
        subject: "Welcome to Swash Window Cleaning",
        body: welcomeMessage,
        source: "rep-log-embed",
        quoteId: quote.id || null,
      });
      return true;
    } catch (error) {
      if (!silent) console.warn("Email send failed", error);
      return false;
    }
  }

  renderOfflineQueue() {
    if (!this.q.queueAlerts) return;
    const queue = getQueue();
    if (!queue.length) {
      this.q.queueAlerts.hidden = true;
      this.q.queueAlerts.innerHTML = "";
      return;
    }
    this.q.queueAlerts.hidden = false;
    this.q.queueAlerts.innerHTML = queue
      .map(
        (item) => `
        <div class="queue-item">
          <span>Quote for ${escapeHtml(item.customerName || item.address || item.refCode)} pending.</span>
          <button type="button" class="btn btn-secondary queue-send" data-ref="${item.refCode}">Send now</button>
        </div>
      `,
      )
      .join("");
  }

  async handleSendQueuedQuote(refCode) {
    const queue = getQueue();
    const quote = queue.find((item) => item.refCode === refCode);
    if (!quote) return;
    if (!navigator.onLine) {
      alert("Offline. Reconnect before sending queued quotes.");
      return;
    }
    const stored = await this.persistQuote(quote);
    if (!stored) {
      alert("Quote could not be saved yet. Try again later.");
      return;
    }
    const emailSent = await this.sendQuoteEmail(quote);
    if (!emailSent) {
      alert("Quote saved but email failed. Retry later.");
      return;
    }
    removeFromQueue(refCode);
    this.renderOfflineQueue();
    this.emitStatus("queue_sent", { quote });
  }

  forwardQueueSync(event) {
    const quote = event.detail?.quote;
    if (!quote || !navigator.onLine) return;
    this.sendQuoteEmail(quote, { silent: true });
  }

  async openLocationModal() {
    if (!this.q.address?.value?.trim()) {
      alert("Please enter the customer address first.");
      return;
    }
    await ensureEmbedGoogleMaps();
    this.showLocationModal();
    this.initLocationMap();
    if (this.q.locationAddressDisplay)
      this.q.locationAddressDisplay.textContent = this.q.address.value.trim();
    const lat = parseFloat(this.q.customerLatitude?.value);
    const lng = parseFloat(this.q.customerLongitude?.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.updateLocationPickerPosition(lat, lng, { zoom: 17 });
      if (this.q.locationGpsStatus) {
        this.q.locationGpsStatus.hidden = false;
        this.q.locationGpsStatus.textContent = "Using previously saved location.";
      }
    } else {
      // Try both: device location and address geocode as a fallback/bias
      this.requestCurrentPositionForLocationModal();
      try { await this.tryGeocodeAddressLocationFallback(); } catch(_) {}
    }
  }

  showLocationModal() {
    this.q.locationModal?.removeAttribute("hidden");
  }

  hideLocationModal() {
    this.q.locationModal?.setAttribute("hidden", "hidden");
  }

  initLocationMap() {
    if (this.locationMap || !window.google?.maps || !this.q.locationMapCanvas) return;
    const initial = {
      lat: Number(this.q.customerLatitude?.value) || 51.7356,
      lng: Number(this.q.customerLongitude?.value) || 0.6756,
    };
    this.locationMap = new google.maps.Map(this.q.locationMapCanvas, {
      zoom: 15,
      center: initial,
      mapTypeId: "roadmap",
    });
    this.locationMarker = new google.maps.Marker({
      position: initial,
      map: this.locationMap,
      draggable: true,
      title: "Customer location",
    });
    this.locationMarker.addListener("drag", () => {
      const pos = this.locationMarker.getPosition();
      this.updateLocationPickerPosition(pos.lat(), pos.lng(), { pan: false });
    });
    this.locationMap.addListener("click", (event) => {
      const lat = event.latLng.lat();
      const lng = event.latLng.lng();
      this.updateLocationPickerPosition(lat, lng, { pan: false });
    });
    this.updateLocationPickerPosition(initial.lat, initial.lng, { pan: false });
  }

  distanceKm(a, b) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
  }

  async tryGeocodeAddressLocationFallback() {
    try {
      if (!window.google?.maps?.Geocoder) return;
      const address = (this.q.address?.value || '').trim();
      if (!address) return;
      const geocoder = new google.maps.Geocoder();
      const result = await new Promise((resolve) => {
        geocoder.geocode({ address: address + ', UK' }, (results, status) => {
          if (status === google.maps.GeocoderStatus.OK && results && results[0]) resolve(results[0]);
          else resolve(null);
        });
      });
      if (!result) return;
      const loc = result.geometry?.location;
      if (!loc) return;
      const addrPos = { lat: loc.lat(), lng: loc.lng() };
      // If no device position yet, or device pos is far away (> 25km), prefer address geocode
      const curLat = parseFloat(this.q.locationLatInput?.value);
      const curLng = parseFloat(this.q.locationLngInput?.value);
      const hasCur = Number.isFinite(curLat) && Number.isFinite(curLng);
      const far = hasCur ? (this.distanceKm({ lat: curLat, lng: curLng }, addrPos) > 25) : true;
      if (!hasCur || far) {
        this.updateLocationPickerPosition(addrPos.lat, addrPos.lng, { zoom: 17 });
        if (this.q.locationGpsStatus) {
          this.q.locationGpsStatus.hidden = false;
          this.q.locationGpsStatus.textContent = 'Location set from address. Adjust the pin if needed.';
        }
      }
    } catch(_) {}
  }

  updateLocationPickerPosition(lat, lng, { pan = true, zoom = null } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (this.q.locationLatInput) this.q.locationLatInput.value = lat.toFixed(6);
    if (this.q.locationLngInput) this.q.locationLngInput.value = lng.toFixed(6);
    if (this.locationMarker) this.locationMarker.setPosition({ lat, lng });
    if (this.locationMap && pan) this.locationMap.panTo({ lat, lng });
    if (this.locationMap && Number.isFinite(zoom)) this.locationMap.setZoom(zoom);
  }

  requestCurrentPositionForLocationModal() {
    if (!navigator?.geolocation || !this.q.locationGpsStatus) return;
    this.q.locationGpsStatus.hidden = false;
    this.q.locationGpsStatus.textContent = "Detecting your current location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords || {};
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          this.updateLocationPickerPosition(latitude, longitude, { zoom: 18 });
          this.q.locationGpsStatus.textContent = "Location detected. Save to confirm.";
        }
      },
      () => {
        this.q.locationGpsStatus.textContent =
          "Couldn't use device location. Drag the pin to the property.";
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  persistLocationFromModal() {
    const lat = parseFloat(this.q.locationLatInput?.value);
    const lng = parseFloat(this.q.locationLngInput?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      alert("Please set a valid location on the map.");
      return;
    }
    if (this.q.customerLatitude) this.q.customerLatitude.value = lat;
    if (this.q.customerLongitude) this.q.customerLongitude.value = lng;
    this.hideLocationModal();
    alert(`✓ Location saved: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  }

  handleManualLocationInput() {
    const lat = parseFloat(this.q.locationLatInput?.value);
    const lng = parseFloat(this.q.locationLngInput?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.updateLocationPickerPosition(lat, lng, { pan: true });
  }

  async ensureEmailJs() {
    if (window.emailjs?.init) return;
    if (!embedEmailJsPromise) {
      embedEmailJsPromise = import(
        "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"
      ).then((mod) => {
        window.emailjs = mod?.default || mod;
        window.emailjs?.init?.(EMBED_EMAIL_PUBLIC_KEY);
      });
    }
    await embedEmailJsPromise;
  }

  emitStatus(status, payload = {}) {
    if (this.onStatus) this.onStatus({ status, type: status, ...payload });
  }
}

function buildEmbedTemplate() {
  return `
    <div class="quote-modal-shell">
      <main class="page">
        <section class="card">
          <header class="card-header">
            <h2>Add Customer</h2>
            <p id="tierDescription">Select a service tier to see the details.</p>
          </header>
          <section id="customerFields" class="customer-section customer-box" hidden>
            <h3>Customer Details</h3>
            <div class="form-grid">
              <label for="customerName">Full Name</label>
              <input id="customerName" autocomplete="name" required />
              <label for="address">Address</label>
              <input id="address" autocomplete="street-address" required />
              <label for="mobile">Mobile</label>
              <input id="mobile" autocomplete="tel" required />
              <label for="email">Email</label>
              <input id="email" type="email" autocomplete="email" required />
            </div>
          </section>
          <form id="quoteForm" class="form-grid" autocomplete="off">
            <label class="form-section" for="repCode" hidden>
              <span>Rep Code</span>
              <input id="repCode" name="repCode" required value="Website Quote" />
            </label>
            <label class="form-section" for="quoteDate" hidden>
              <span>Quote Date</span>
              <input id="quoteDate" name="quoteDate" readonly />
            </label>
            <div class="options-box">
              <div class="form-grid">
                <label class="form-section" for="serviceTier">
                  <span>Service Tier</span>
                  <select id="serviceTier" name="serviceTier">
                    <option value="gold" selected>Gold</option>
                    <option value="silver">Silver</option>
                  </select>
                </label>
                <div class="inline-two">
                  <label class="form-section" for="houseSize">
                    <span>House Size</span>
                    <select id="houseSize" name="houseSize">
                      <option>2 bed</option>
                      <option>3 bed</option>
                      <option>4 bed</option>
                      <option>5 bed</option>
                      <option>6 bed</option>
                    </select>
                  </label>
                  <label class="form-section" for="houseType">
                    <span>House Type</span>
                    <select id="houseType" name="houseType">
                      <option value="Bungalow">Bungalow</option>
                      <option value="Maisonette">Maisonette</option>
                      <option value="Terrace">Terrace</option>
                      <option value="Semi-Detached">Semi-Detached</option>
                      <option value="Detached">Detached</option>
                      <option value="Mobile Home">Mobile Home</option>
                    </select>
                  </label>
                </div>
                <div class="inline-two inline-two--mobile-2">
                  <label class="form-section checkbox checkbox--lg" for="conservatory">
                    <input type="checkbox" id="conservatory" />
                    <span>Conservatory</span>
                  </label>
                  <label class="form-section checkbox checkbox--lg" for="extension">
                    <input type="checkbox" id="extension" />
                    <span>Extension</span>
                  </label>
                </div>
                <label class="form-section" for="roofLanterns">
                  <span>Roof Lanterns</span>
                  <div class="slider-row">
                    <input type="range" id="roofLanterns" min="0" max="10" value="0" step="1" />
                    <span class="slider-value" id="roofLanternsValue">0</span>
                  </div>
                </label>
                <label class="form-section" for="skylights">
                  <span>Skylights</span>
                  <div class="slider-row">
                    <input type="range" id="skylights" min="0" max="10" value="0" step="1" />
                    <span class="slider-value" id="skylightsValue">0</span>
                  </div>
                </label>
                <input type="hidden" id="partialCleaning" value="100" />
                <input type="hidden" id="addVAT" value="true" />
                <label class="form-section" for="notes">
                  <span>Notes</span>
                  <textarea id="notes" rows="3" placeholder="Add any customer notes or access information..."></textarea>
                </label>
                <div style="margin-bottom: 16px; padding: 12px; background: #f0f7ff; border-left: 4px solid #0078d7; border-radius: 4px;">
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; color: #1e293b;" for="setLocation">
                    <input type="checkbox" id="setLocation" style="cursor: pointer; width: 18px; height: 18px;" />
                    📍 Set Customer Location
                  </label>
                  <p style="margin: 8px 0 0 26px; color: #64748b; font-size: 0.85rem;">Click the button below to set the exact customer location on a map.</p>
                </div>
                <div style="margin-bottom: 16px;">
                  <button type="button" id="setLocationBtn" class="btn btn-secondary" style="width: 100%;">📍 Set Location on Map</button>
                </div>
                <input type="hidden" id="customerLatitude" />
                <input type="hidden" id="customerLongitude" />
              </div>
            </div>
          </form>
          <div class="form-actions form-actions--end form-actions--compact" style="margin-bottom: 8px;">
            <label class="checkbox checkbox--lg" for="alternating">
              <input type="checkbox" id="alternating" />
              <span>Alternating Clean</span>
            </label>
            <label class="checkbox checkbox--lg" for="frontOnly">
              <input type="checkbox" id="frontOnly" />
              <span>Front Only</span>
            </label>
            <button type="button" id="applyOfferBtn" class="btn btn-offer">Apply Special Offer</button>
          </div>
          <section id="result" class="result-panel" aria-live="polite"></section>
          <div class="form-grid">
            <label class="form-section" for="emailMessage" hidden>
              <span>Email message</span>
              <textarea id="emailMessage" rows="10" placeholder="This message will be sent to the customer."></textarea>
            </label>
          </div>
          <div class="form-actions form-actions--end">
            <button type="button" id="submitBtn" class="btn btn-primary">Schedule First Clean</button>
          </div>
          <aside id="paymentRefBox" class="payment-ref" hidden>
            <p><strong>Payment Reference:</strong> <span id="paymentRefValue"></span></p>
          </aside>
          <section id="emailPreviewCard" class="email-preview-card" hidden>
            <div class="email-preview-header">
              <h3>Email Preview</h3>
              <p id="emailPreviewSubject" class="email-preview-subject"></p>
            </div>
            <div id="emailPreviewBody" class="email-preview-body"></div>
          </section>
          <section id="queueAlerts" class="queue-alerts" hidden aria-live="polite"></section>
        </section>
      </main>
      <div id="setCustomerLocationModal" class="location-modal" hidden>
        <div class="modal__dialog">
          <div class="modal__header">
            <h3>Set Customer Location</h3>
            <button type="button" class="modal__close" id="closeLocationModal" aria-label="Close">×</button>
          </div>
          <p class="modal__hint">Drag the pin to the exact customer location. Address: <strong id="locationAddressDisplay"></strong></p>
          <div id="locationMap" class="location-map"></div>
          <p id="locationGpsStatus" class="location-gps-status" hidden></p>
          <button type="button" class="btn btn-secondary" id="useCurrentLocation">Use my current location</button>
          <div class="modal__grid">
            <label class="modal__field">
              <span>Latitude</span>
              <input id="locationLatInput" type="number" placeholder="Latitude" step="0.0001" />
            </label>
            <label class="modal__field">
              <span>Longitude</span>
              <input id="locationLngInput" type="number" placeholder="Longitude" step="0.0001" />
            </label>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn btn-secondary" id="cancelLocationBtn">Cancel</button>
            <button type="button" class="btn btn-primary" id="saveLocationBtn">Save Location</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildPricePanelMarkup(pricing = {}) {
  const pricePer = Number(pricing.pricePerClean || 0).toFixed(2);
  return `
    <div class="price-panel" style="display:flex;flex-wrap:wrap;gap:16px;align-items:stretch;">
      <div style="flex:1 1 100%;background:linear-gradient(135deg,#0e5ecb,#009ad6);color:#ecf5ff;padding:24px 28px;border-radius:16px;box-shadow:0 15px 35px rgba(14,94,203,0.25);text-align:center;">
        <p style="margin:0 0 8px;font-size:.9rem;text-transform:uppercase;letter-spacing:.08em;color:#bfe3ff;">Price per clean</p>
        <p style="margin:0;font-size:3rem;font-weight:700;color:#fff;">£${pricePer}</p>
        <p style="margin:8px 0 0;color:#e0efff;font-size:1.1rem;">Every 4 weeks</p>
      </div>
    </div>
  `;
}

function buildQuotePageResultMarkup(pricing = {}, { offerActive = false, expiresAt = null } = {}) {
  const pricePer = Number(pricing.pricePerClean || 0).toFixed(2);
  const expiresCopy = offerActive && expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB")
    : null;
  const offerHtml = offerActive
    ? `<p class="result-offer">Special offer applied${expiresCopy ? ` – expires ${expiresCopy}` : ""}</p>`
    : "";
  return `
    <div class="result-box">
      <p class="result-price" style="font-size:1.3rem;text-align:center;margin:0;"><strong>£${pricePer}</strong> per clean</p>
      <p style="text-align:center;color:#64748b;margin:8px 0 0;font-size:0.95rem;">Every 4 weeks</p>
      ${offerHtml}
    </div>
  `;
}

function buildEmbedSummary(quote, { storedOnline, emailSent }) {
  const plan = quote.tier ? `${quote.tier.charAt(0).toUpperCase()}${quote.tier.slice(1)}` : "Plan";
  const base = `Quote: ${plan} @ £${quote.pricePerClean.toFixed(2)} / clean (Upfront £${quote.price.toFixed(
    2,
  )}) Ref ${quote.refCode}`;
  if (!storedOnline) return `${base} [queued offline]`;
  return emailSent ? `${base} [emailed]` : base;
}

function buildEmbedEmailPayload(quote) {
  return {
    customer_name: quote.customerName,
    ref_code: quote.refCode,
    date: new Date().toLocaleDateString("en-GB"),
    second_date: "",
    third_date: "",
    email: quote.email,
    message_body: buildEmbedEmailMessage(quote),
  };
}

function buildEmbedEmailMessage(quote) {
  return `Hi ${quote.customerName || 'there'},\n\nThank you for choosing Swash Window Cleaning. A member of our team will contact you soon to book your first clean in.\n\nBest regards,\nThe Swash Team`;
}

function computeEmbedOfferExpiryIso() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function generateEmbedReference() {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REF${Date.now().toString().slice(-4)}${random}`;
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c),
  );
}

function normalizeEmail(value = "") {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return "";
  return trimmed;
}

async function ensureEmbedGoogleMaps() {
  if (window.google?.maps) return;
  if (!embedMapsPromise) {
    embedMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = EMBED_GOOGLE_MAPS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });
  }
  await embedMapsPromise;
}
