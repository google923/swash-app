import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ensureSubscriberAccess } from "./lib/subscriber-access.js";
import { tenantDoc } from "./lib/subscriber-paths.js";

const DEFAULT_SETTINGS = {
  tiers: {
    silver: {
      label: "Silver",
      description: "Windows only, every 4 weeks.",
    },
    gold: {
      label: "Gold",
      description: "Frames, sills and reminders included.",
      multiplier: 1.35,
    },
    offerLabel: "Gold upgrade included",
  },
  pricing: {
    minimum: 16,
    vatIncluded: true,
    baseBySize: {
      "2 bed": 21,
      "3 bed": 24,
      "4 bed": 28,
      "5 bed": 32,
      "6 bed": 36,
    },
    extensionAdd: 4,
    conservatoryAdd: 6,
    roofLanternEach: 10,
    skylightEach: 1.5,
    alternatingFactor: 0.5,
    frontOnlyFactor: 0.6,
  },
  houseTypeMultipliers: {
    "Bungalow": 0.94,
    "Maisonette": 0.96,
    "Terrace": 1,
    "Semi-Detached": 1,
    "Detached": 1.08,
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
    accentColor: "#0ea5e9",
    backgroundColor: "#ffffff",
    buttonTextColor: "#ffffff",
    logoUrl: "",
    heroImageUrl: "",
    cornerStyle: "rounded",
  },
  previewCopy: {
    heading: "Get your instant quote",
    subheading: "Choose a plan and book your first visit in minutes.",
    buttonLabel: "Start quote",
  },
  frequencyOptions: ["Every 4 weeks", "Every 8 weeks"],
  updatedAt: null,
};

const NUMBER_PATHS = new Set([
  "tiers.gold.multiplier",
  "pricing.minimum",
  "pricing.baseBySize.2 bed",
  "pricing.baseBySize.3 bed",
  "pricing.baseBySize.4 bed",
  "pricing.baseBySize.5 bed",
  "pricing.baseBySize.6 bed",
  "pricing.extensionAdd",
  "pricing.conservatoryAdd",
  "pricing.roofLanternEach",
  "pricing.skylightEach",
  "pricing.alternatingFactor",
  "pricing.frontOnlyFactor",
  "houseTypeMultipliers.Bungalow",
  "houseTypeMultipliers.Maisonette",
  "houseTypeMultipliers.Terrace",
  "houseTypeMultipliers.Semi-Detached",
  "houseTypeMultipliers.Detached",
  "houseTypeMultipliers.Mobile Home",
]);

const BOOLEAN_PATHS = new Set([
  "pricing.vatIncluded",
  "toggles.enableAlternating",
  "toggles.enableFrontOnly",
  "toggles.showOfferButton",
  "toggles.showNotesField",
]);

const SIZE_MULTIPLIERS = {
  "2 bed": 1,
  "3 bed": 1.18,
  "4 bed": 1.34,
  "5 bed": 1.52,
  "6 bed": 1.7,
};

const HOUSE_TYPE_PRESET = {
  "Bungalow": 0.94,
  "Maisonette": 0.96,
  "Terrace": 0.99,
  "Semi-Detached": 1,
  "Detached": 1.08,
  "Mobile Home": 0.9,
};

let relativeTimer = null;
let helperInitialised = false;

const state = {
  subscriberId: null,
  viewerRole: null,
  viewerProfile: null,
  settings: clone(DEFAULT_SETTINGS),
  dirty: false,
  previewMode: "customer",
};

const elements = {
  overlay: document.getElementById("authOverlay"),
  page: document.getElementById("settingsContent"),
  logoutBtn: document.getElementById("logoutBtn"),
  saveBtn: document.getElementById("saveBtn"),
  resetBtn: document.getElementById("resetBtn"),
  saveStatus: document.getElementById("saveStatus"),
  updateBadge: document.getElementById("updateBadge"),
  updateBadgeTime: document.querySelector("#updateBadge [data-relative-time]"),
  copyWebsiteBtn: document.getElementById("copyWebsiteSnippetBtn"),
  copyInternalBtn: document.getElementById("copyInternalSnippetBtn"),
  websitePreview: document.getElementById("websitePreview"),
  internalPreview: document.getElementById("internalPreview"),
  websiteSnippet: document.getElementById("websiteSnippet"),
  internalSnippet: document.getElementById("internalSnippet"),
  minimumPrice: document.getElementById("minimumPrice"),
  suggestPricingBtn: document.getElementById("suggestPricingBtn"),
  helperGuide: document.getElementById("helperGuide"),
  helperDismissBtn: document.querySelector("[data-helper-dismiss]"),
  previewToggleGroup: document.getElementById("previewToggleGroup"),
  interactivePreviewStage: document.getElementById("interactivePreviewStage"),
  interactivePreviewBody: document.getElementById("interactivePreviewBody"),
  frequencyOptionsInput: document.getElementById("frequencyOptionsInput"),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  const merged = Array.isArray(target) ? [...target] : { ...target };
  Object.keys(source || {}).forEach((key) => {
    const sourceValue = source[key];
    if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)) {
      merged[key] = deepMerge(target[key] ?? {}, sourceValue);
    } else {
      merged[key] = sourceValue;
    }
  });
  return merged;
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let cursor = obj;
  for (const part of parts) {
    if (!cursor[part] || typeof cursor[part] !== "object") {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[last] = value;
}

function normalizeHexColor(value) {
  if (!value) return null;
  let hex = String(value).trim();
  if (!hex) return null;
  if (!hex.startsWith("#")) return null;
  hex = hex.slice(1);
  if (hex.length === 3) {
    hex = hex.split("").map((char) => char + char).join("");
  } else if (hex.length === 8) {
    hex = hex.slice(0, 6);
  }
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const int = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(colorA, colorB, amount = 0.5) {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  if (!rgbA || !rgbB) return null;
  const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
  const mix = {
    r: rgbA.r * (1 - ratio) + rgbB.r * ratio,
    g: rgbA.g * (1 - ratio) + rgbB.g * ratio,
    b: rgbA.b * (1 - ratio) + rgbB.b * ratio,
  };
  return rgbToHex(mix);
}

function lightenHex(color, amount = 0.5) {
  return mixHex(color, "#ffffff", amount);
}

function darkenHex(color, amount = 0.5) {
  return mixHex(color, "#000000", amount);
}

function rgbaString(color, alpha) {
  const rgb = hexToRgb(color);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  if (!rgb) return `rgba(15,23,42,${safeAlpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

function ensureColor(value, fallback) {
  return normalizeHexColor(value) || fallback;
}

function getReadableTextColor(background, light = "#ffffff", dark = "#0f172a") {
  const rgb = hexToRgb(background);
  if (!rgb) return dark;
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.6 ? dark : light;
}

function sanitizeExternalUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.href;
  } catch (_error) {
    return "";
  }
}

function syncLinkedInputs(path, sourceField) {
  const value = getPath(state.settings, path);
  document.querySelectorAll(`[data-setting-path="${path}"]`).forEach((field) => {
    if (field === sourceField) return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field.tagName === "SELECT") {
      field.value = Boolean(BOOLEAN_PATHS.has(path)) ? String(Boolean(value)) : String(value ?? "");
    } else {
      field.value = value ?? "";
    }
  });
}

function parseValueForPath(path, rawValue, inputType) {
  if (BOOLEAN_PATHS.has(path)) {
    if (inputType === "select-one") {
      return rawValue === "true";
    }
    return Boolean(rawValue);
  }
  if (NUMBER_PATHS.has(path)) {
    const parsed = Number.parseFloat(rawValue);
    if (Number.isNaN(parsed)) return 0;
    return parsed;
  }
  return rawValue ?? "";
}

function roundCurrency(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return Number.isFinite(rounded) ? rounded : 0;
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "£0.00";
  return `£${amount.toFixed(2)}`;
}

function parseFrequencyInput(rawValue) {
  if (typeof rawValue !== "string") return [];
  return rawValue
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line, index, arr) => line.length && arr.indexOf(line) === index);
}

function ensureFrequencyOptions(options) {
  if (!Array.isArray(options) || !options.length) {
    return [...DEFAULT_SETTINGS.frequencyOptions];
  }
  const cleaned = options
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, arr) => value.length && arr.indexOf(value) === index);
  return cleaned.length ? cleaned : [...DEFAULT_SETTINGS.frequencyOptions];
}

function resolveFrequencyDays(label) {
  if (!label) return 28;
  const value = label.trim().toLowerCase();
  const everyMatch = value.match(/every\s+(\d+(?:\.\d+)?)\s*(week|day|month)/);
  if (everyMatch) {
    const amount = Number.parseFloat(everyMatch[1]);
    const unit = everyMatch[2];
    if (Number.isFinite(amount) && amount > 0) {
      if (unit.startsWith("week")) return Math.round(amount * 7);
      if (unit.startsWith("month")) return Math.round(amount * 30);
      if (unit.startsWith("day")) return Math.round(amount);
    }
  }
  if (value.includes("fortnight")) return 14;
  if (value.includes("monthly")) return 30;
  if (value.includes("two")) return 14;
  return 28;
}

function formatScheduleDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function flashNode(node) {
  if (!node) return;
  const target = node.closest ? node.closest("label") || node : node;
  target.classList.add("highlight-flash");
  window.setTimeout(() => {
    target.classList.remove("highlight-flash");
  }, 1200);
}

function focusAndHighlight(targetId) {
  if (!targetId) return;
  const direct = document.getElementById(targetId);
  const pathMatch = document.querySelector(`[data-setting-path="${targetId}"]`);
  const node = direct || pathMatch;
  if (!node) return;

  const rect = node.getBoundingClientRect();
  const top = rect.top + window.scrollY - 96;
  window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });

  window.setTimeout(() => {
    if (typeof node.focus === "function") {
      try { node.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
    flashNode(node);
  }, 260);
}

function formatRelativeTime(date) {
  if (!date) return "--";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function applySettingsToInputs() {
  document.querySelectorAll("[data-setting-path]").forEach((field) => {
    const path = field.dataset.settingPath;
    const value = getPath(state.settings, path);
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field.tagName === "SELECT") {
      const stringValue = Boolean(BOOLEAN_PATHS.has(path)) ? String(Boolean(value)) : String(value ?? "");
      field.value = stringValue;
    } else {
      field.value = value ?? "";
    }
  });
  if (elements.frequencyOptionsInput) {
    const lines = ensureFrequencyOptions(state.settings.frequencyOptions);
    elements.frequencyOptionsInput.value = lines.join("\n");
  }
}

function attachFieldListeners() {
  document.querySelectorAll("[data-setting-path]").forEach((field) => {
    const path = field.dataset.settingPath;
    const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(eventName, () => {
      let rawValue;
      if (field.type === "checkbox") {
        rawValue = field.checked;
      } else if (field.tagName === "SELECT") {
        rawValue = field.value;
      } else {
        rawValue = field.value;
      }
      const parsed = parseValueForPath(path, rawValue, field.type);
      setPath(state.settings, path, parsed);
      syncLinkedInputs(path, field);
      markDirty();
      updatePreviews();
    });
  });
  if (elements.frequencyOptionsInput) {
    elements.frequencyOptionsInput.addEventListener("input", () => {
      const parsed = ensureFrequencyOptions(parseFrequencyInput(elements.frequencyOptionsInput.value));
      state.settings.frequencyOptions = parsed;
      markDirty();
      updatePreviews();
    });
  }
}

function markDirty() {
  state.dirty = true;
  if (elements.saveStatus) {
    elements.saveStatus.textContent = "Unsaved changes";
    elements.saveStatus.style.color = "#ca8a04";
  }
}

function clearDirtyStatus(message = "Settings saved") {
  state.dirty = false;
  if (elements.saveStatus) {
    elements.saveStatus.textContent = message;
    elements.saveStatus.style.color = "#64748b";
  }
}

function getTierMultiplier(tierKey) {
  if (tierKey === "gold") {
    const mult = Number(state.settings?.tiers?.gold?.multiplier ?? 1);
    return Number.isFinite(mult) && mult > 0 ? mult : 1;
  }
  return 1;
}

function computePriceSample({ tier = "gold", size = "3 bed", houseType = "Semi-Detached", opts = {} } = {}) {
  const pricing = state.settings.pricing || {};
  const base = Number(pricing.baseBySize?.[size] ?? 0);
  const typeMult = Number(state.settings.houseTypeMultipliers?.[houseType] ?? 1);
  const tierMult = getTierMultiplier(tier);
  let price = base * typeMult * tierMult;
  if (opts.extension) price += Number(pricing.extensionAdd ?? 0);
  if (opts.conservatory) price += Number(pricing.conservatoryAdd ?? 0);
  if (opts.roofLanterns) price += Number(pricing.roofLanternEach ?? 0) * opts.roofLanterns;
  if (opts.skylights) price += Number(pricing.skylightEach ?? 0) * opts.skylights;
  if (opts.alternating) price *= Number(pricing.alternatingFactor ?? 1);
  if (opts.frontOnly) price *= Number(pricing.frontOnlyFactor ?? 1);
  price = Math.max(price, Number(pricing.minimum ?? 0));
  if (pricing.vatIncluded) {
    price = Math.round(price * 100) / 100;
  }
  return price;
}

function updateWebsitePreview() {
  if (!elements.websitePreview) return;
  const styling = state.settings.styling || {};
  const previewCopy = state.settings.previewCopy || {};
  const tiers = state.settings.tiers || {};
  const samplePrice = computePriceSample({ tier: "gold", opts: { conservatory: true } }).toFixed(2);
  const corner = styling.cornerStyle === "pill" ? "999px" : styling.cornerStyle === "square" ? "6px" : "12px";
  const primary = styling.primaryColor || "#0f172a";
  const accent = styling.accentColor || "#0ea5e9";
  const buttonColor = styling.buttonTextColor || "#ffffff";
  const logo = styling.logoUrl ? `<img src="${escapeHtml(styling.logoUrl)}" alt="Logo" style="max-height:32px;margin-bottom:12px;" />` : "";
  elements.websitePreview.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;background:${styling.backgroundColor || "#ffffff"};color:${primary};border-radius:${corner};padding:18px;border:1px solid rgba(15,23,42,0.08);">
      ${logo}
      <h4 style="margin:0;color:${primary};">${escapeHtml(previewCopy.heading || "Get your instant quote")}</h4>
      <p style="margin:0;color:#475569;">${escapeHtml(previewCopy.subheading || "Book a clean in minutes.")}</p>
      <div style="padding:12px;border-radius:10px;background:rgba(14,165,233,0.1);color:#0f172a;display:flex;flex-direction:column;gap:6px;">
        <strong>${escapeHtml(tiers.gold?.label || "Gold")} • £${samplePrice}</strong>
        <span>${escapeHtml(tiers.gold?.description || "Frames and sills included")}</span>
      </div>
      <button style="background:${accent};color:${buttonColor};border:none;border-radius:${corner};padding:12px 16px;font-weight:700;cursor:default;">${escapeHtml(previewCopy.buttonLabel || "Start quote")}</button>
    </div>
  `;
}

function updateInternalPreview() {
  if (!elements.internalPreview) return;
  const tiers = state.settings.tiers || {};
  const toggles = state.settings.toggles || {};
  const pricing = state.settings.pricing || {};
  const silverPrice = computePriceSample({ tier: "silver" }).toFixed(2);
  const goldPrice = computePriceSample({ tier: "gold", opts: { extension: true } }).toFixed(2);
  const alternatingFactor = Number(pricing.alternatingFactor ?? 0.5);
  const frontOnlyFactor = Number(pricing.frontOnlyFactor ?? 0.6);
  const alternatingCopy = toggles.enableAlternating ? `<li>Alternating clean factor enabled (${(Number.isFinite(alternatingFactor) ? alternatingFactor : 0.5).toFixed(2)}x)</li>` : "";
  const frontOnlyCopy = toggles.enableFrontOnly ? `<li>Front-only option enabled (${(Number.isFinite(frontOnlyFactor) ? frontOnlyFactor : 0.6).toFixed(2)}x)</li>` : "";
  elements.internalPreview.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="preview-chip">Internal view</div>
      <div style="display:grid;gap:8px;">
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:10px;">
          <strong>${escapeHtml(tiers.silver?.label || "Silver")}</strong>
          <p style="margin:4px 0 0;color:#475569;">£${silverPrice} • ${escapeHtml(tiers.silver?.description || "Windows only")}</p>
        </div>
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:10px;">
          <strong>${escapeHtml(tiers.gold?.label || "Gold")}</strong>
          <p style="margin:4px 0 0;color:#475569;">£${goldPrice} • ${escapeHtml(tiers.gold?.description || "Frames and sills")}</p>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;color:#475569;font-size:0.9rem;">
        ${alternatingCopy}
        ${frontOnlyCopy}
        <li>Offer button ${toggles.showOfferButton ? "visible" : "hidden"}</li>
        <li>Notes field ${toggles.showNotesField ? "visible" : "hidden"}</li>
      </ul>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
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

function updateSnippets() {
  if (!elements.websiteSnippet || !elements.internalSnippet) return;
  const origin = window.location.origin;
  const subscriberParam = state.subscriberId ? `&subscriber=${encodeURIComponent(state.subscriberId)}` : "";
  const baseUrl = `${origin}/rep/add-new-customer.html?embed=true${subscriberParam}`;
  const websiteUrl = `${baseUrl}&mode=public`;
  const internalUrl = `${baseUrl}&mode=internal`;
  elements.websiteSnippet.value = `<iframe src="${websiteUrl}" width="100%" height="1080" style="border:0;border-radius:12px;" title="Swash Quote"></iframe>`;
  elements.internalSnippet.value = `<iframe src="${internalUrl}" width="100%" height="1080" style="border:0;" title="Swash Quote"></iframe>`;
}

function updatePreviews() {
  updateWebsitePreview();
  updateInternalPreview();
  renderInteractivePreview();
  updateSnippets();
}

function applyPreviewTheme() {
  const stage = elements.interactivePreviewStage;
  if (!stage) return;
  const target = stage.closest(".live-preview") || stage;
  const styling = state.settings.styling || {};

  const primary = ensureColor(styling.primaryColor, "#0f172a");
  const accent = ensureColor(styling.accentColor, primary);
  const background = ensureColor(styling.backgroundColor, "#ffffff");
  const buttonText = ensureColor(styling.buttonTextColor, "#ffffff");
  const heroImageActive = Boolean(sanitizeExternalUrl(styling.heroImageUrl));

  const shellBg = lightenHex(primary, 0.78) || "#dbeafe";
  const stageBg = lightenHex(primary, 0.86) || "#eff6ff";
  const shellBorder = mixHex(primary, background, 0.5) || "#bfdbfe";
  const stageBorder = mixHex(primary, background, 0.35) || "#cbd5e1";
  const sectionBorder = mixHex(primary, background, 0.62) || "#dbeafe";
  const summaryBg = mixHex(background, "#f8fafc", 0.5) || "#f8fafc";
  const chipBg = mixHex(accent, background, 0.75) || "#e0f2fe";
  const chipText = getReadableTextColor(chipBg);
  const pillBg = accent;
  const pillText = getReadableTextColor(pillBg);
  const noteColor = mixHex(primary, background, 0.68) || "#475569";
  const secondaryBg = mixHex(accent, background, 0.82) || "#e2e8f0";
  const secondaryText = getReadableTextColor(secondaryBg);
  const heroBase = heroImageActive ? mixHex(primary, background, 0.4) || shellBg : shellBg;
  const heroText = getReadableTextColor(heroBase);
  const heroOverlay = heroImageActive ? rgbaString(primary, 0.55) : "transparent";
  const inputBorder = mixHex(primary, background, 0.6) || "#cbd5e1";

  const cornerStyle = styling.cornerStyle || "rounded";
  const radiusPresets = {
    rounded: { shell: "22px", section: "18px", input: "12px" },
    pill: { shell: "999px", section: "28px", input: "999px" },
    square: { shell: "12px", section: "10px", input: "6px" },
  };
  const radii = radiusPresets[cornerStyle] || radiusPresets.rounded;

  target.style.setProperty("--preview-primary", primary);
  target.style.setProperty("--preview-accent", accent);
  target.style.setProperty("--preview-background", background);
  target.style.setProperty("--preview-button-text", buttonText);
  target.style.setProperty("--preview-shell-bg", shellBg);
  target.style.setProperty("--preview-shell-border", shellBorder);
  target.style.setProperty("--preview-stage-bg", stageBg);
  target.style.setProperty("--preview-stage-border", stageBorder);
  target.style.setProperty("--preview-section-bg", background);
  target.style.setProperty("--preview-section-border", sectionBorder);
  target.style.setProperty("--preview-radius-shell", radii.shell);
  target.style.setProperty("--preview-radius-section", radii.section);
  target.style.setProperty("--preview-radius-input", radii.input);
  target.style.setProperty("--preview-input-border", inputBorder);
  target.style.setProperty("--preview-note", noteColor);
  target.style.setProperty("--preview-chip-bg", chipBg);
  target.style.setProperty("--preview-chip-text", chipText);
  target.style.setProperty("--preview-secondary-bg", secondaryBg);
  target.style.setProperty("--preview-secondary-text", secondaryText);
  target.style.setProperty("--preview-summary-bg", summaryBg);
  target.style.setProperty("--preview-hero-bg", heroBase);
  target.style.setProperty("--preview-hero-text", heroText);
  target.style.setProperty("--preview-hero-overlay", heroOverlay);
  target.style.setProperty("--preview-pill-bg", pillBg);
  target.style.setProperty("--preview-pill-text", pillText);
}

function renderInteractivePreview() {
  if (!elements.interactivePreviewBody) return;
  const mode = state.previewMode === "team" ? "team" : "customer";
  const tiers = state.settings.tiers || {};
  const pricing = state.settings.pricing || {};
  const toggles = state.settings.toggles || {};
  const styling = state.settings.styling || {};
  const previewCopy = state.settings.previewCopy || {};
  const sizeOptions = Object.keys(pricing.baseBySize || {});
  if (sizeOptions.length === 0) sizeOptions.push("2 bed", "3 bed", "4 bed");
  const frequencyOptions = ensureFrequencyOptions(state.settings.frequencyOptions);
  const houseTypes = Object.keys(state.settings.houseTypeMultipliers || {});
  if (houseTypes.length === 0) houseTypes.push("Terrace", "Semi-Detached", "Detached");

  const heroLogoUrl = sanitizeExternalUrl(styling.logoUrl);
  const heroImageUrl = sanitizeExternalUrl(styling.heroImageUrl);

  const alternatingFactor = Number.isFinite(Number(pricing.alternatingFactor)) ? Number(pricing.alternatingFactor) : 0.5;
  const frontOnlyFactor = Number.isFinite(Number(pricing.frontOnlyFactor)) ? Number(pricing.frontOnlyFactor) : 0.6;

  const tierOptions = [
    { key: "gold", label: tiers.gold?.label || "Gold" },
    { key: "silver", label: tiers.silver?.label || "Silver" },
  ];

  const tierOptionsHtml = tierOptions.map((option) => `<option value="${option.key}">${escapeHtml(option.label)}</option>`).join("");
  const sizeOptionsHtml = sizeOptions.map((size) => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join("");
  const houseOptionsHtml = houseTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  const frequencyOptionsHtml = frequencyOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");

  const notesFieldBlock = toggles.showNotesField || mode === "team"
    ? `<label class="form-section form-field--span-2"><span>Notes</span><textarea rows="3" placeholder="Add any customer notes or access information..." disabled></textarea><span class="preview-quantity-note">Notes are ${toggles.showNotesField ? "available" : "hidden"} on the live form.</span></label>`
    : "";

  const offerButtonBlock = toggles.showOfferButton
    ? `<div class="form-actions form-actions--start"><button type="button" class="btn btn-offer" disabled>Apply Special Offer</button></div>`
    : "";

  const chips = [];
  chips.push(`<span class=\"preview-chip\">${mode === "team" ? "Internal view" : "Customer view"}</span>`);
  if (toggles.showOfferButton) chips.push(`<span class=\"preview-chip\">${escapeHtml(state.settings.tiers?.offerLabel || "Special offer ready")}</span>`);
  const chipsMarkup = chips.length ? `<div class="preview-chip-row">${chips.join("")}</div>` : "";

  const logoMarkup = heroLogoUrl
    ? `<div class="preview-card-header-logo"><img src="${escapeHtml(heroLogoUrl)}" alt="Brand logo" loading="lazy" decoding="async" /></div>`
    : `<div class="preview-card-header-logo preview-card-header-logo--placeholder">Your Logo</div>`;

  const heroBlock = heroImageUrl
    ? `<div class="preview-hero-thumb"><img src="${escapeHtml(heroImageUrl)}" alt="Brand lifestyle" loading="lazy" decoding="async" /></div>`
    : "";

  const primaryCtaLabel = mode === "customer"
    ? escapeHtml(previewCopy.buttonLabel || "Schedule First Clean")
    : "Schedule First Clean";

  const ctaBlock = mode === "team"
    ? `<div class="preview-cta-row form-actions form-actions--end"><button type="button" class="btn btn-secondary" disabled>Email Quote</button><button type="button" class="btn btn-primary" disabled>${primaryCtaLabel}</button></div><p class="preview-status">Internal view shows the follow-up buttons your team use after sending a quote.</p>`
    : `<div class="preview-cta-row form-actions form-actions--end"><button type="button" class="btn btn-primary" disabled>${primaryCtaLabel}</button></div>`;

  const bodyHtml = `
    <section class="card preview-quote-card" data-preview-card data-preview-context="${mode}">
      <header class="card-header preview-card-header" data-preview-header>
        <div class="preview-card-header-text">
          <div class="preview-card-header-top">
            <h2>${escapeHtml(previewCopy.heading || "Add Customer")}</h2>
            ${chipsMarkup}
          </div>
          <p>${escapeHtml(previewCopy.subheading || "Windows, frames, sills and doors, every 4 weeks, notifications included.")}</p>
        </div>
        ${logoMarkup}
      </header>
      ${heroBlock}
      <form class="preview-form-grid" data-preview-form autocomplete="off">
        <label class="form-section">
          <span>Service Tier</span>
          <select data-preview-input="tier">${tierOptionsHtml}</select>
        </label>
        <div class="inline-two">
          <label class="form-section">
            <span>House Size</span>
            <select data-preview-input="propertySize">${sizeOptionsHtml}</select>
          </label>
          <label class="form-section">
            <span>House Type</span>
            <select data-preview-input="houseType">${houseOptionsHtml}</select>
          </label>
        </div>
        <label class="form-section">
          <span>Cleaning Frequency</span>
          <select data-preview-input="frequency">${frequencyOptionsHtml}</select>
        </label>
        <div class="inline-two inline-two--mobile-2">
          <label class="form-section checkbox checkbox--lg">
            <input type="checkbox" data-preview-extra="conservatory" />
            <span>Conservatory</span>
          </label>
          <label class="form-section checkbox checkbox--lg">
            <input type="checkbox" data-preview-extra="extension" />
            <span>Extension</span>
          </label>
        </div>
        <label class="form-section">
          <span>Roof Lanterns</span>
          <div class="slider-row">
            <input type="range" min="0" max="10" step="1" value="0" data-preview-quantity="roofLanterns" />
            <span class="slider-value" data-preview-quantity-output="roofLanterns">0</span>
          </div>
          <span class="preview-quantity-note">${formatCurrency(pricing.roofLanternEach)} each</span>
        </label>
        <label class="form-section">
          <span>Skylights</span>
          <div class="slider-row">
            <input type="range" min="0" max="10" step="1" value="0" data-preview-quantity="skylights" />
            <span class="slider-value" data-preview-quantity-output="skylights">0</span>
          </div>
          <span class="preview-quantity-note">${formatCurrency(pricing.skylightEach)} each</span>
        </label>
        ${notesFieldBlock}
      </form>
      <section class="customer-section customer-box">
        <h3>Customer Details</h3>
        <div class="form-grid">
          <label>Full Name</label>
          <input type="text" placeholder="Full name" disabled />
          <label>Address</label>
          <input type="text" placeholder="Street, Town, Postcode" disabled />
          <div class="location-helper" style="grid-column:1 / -1; display:flex; flex-direction:column; gap:10px; padding:12px; background:#f0f7ff; border-radius:8px; border:1px solid #c4ddf6;">
            <p style="margin:0; font-size:0.9rem; color:#1e293b;">Set the pin on the map so we can match you to the right cleaning day.</p>
            <button type="button" class="btn btn-secondary" style="width:100%;" disabled>📍 Set Location on Map</button>
          </div>
          <label>Mobile</label>
          <input type="tel" placeholder="07..." disabled />
          <label>Email</label>
          <input type="email" placeholder="customer@email.com" disabled />
        </div>
      </section>
      <div class="preview-toggle-row">
        <label class="checkbox checkbox--lg ${toggles.enableAlternating ? "" : "is-disabled"}">
          <input type="checkbox" data-preview-toggle="alternating" ${toggles.enableAlternating ? "" : "disabled"} />
          <span>Alternating Clean (${alternatingFactor.toFixed(2)}x)</span>
        </label>
        <label class="checkbox checkbox--lg ${toggles.enableFrontOnly ? "" : "is-disabled"}">
          <input type="checkbox" data-preview-toggle="frontOnly" ${toggles.enableFrontOnly ? "" : "disabled"} />
          <span>Front Only (${frontOnlyFactor.toFixed(2)}x)</span>
        </label>
      </div>
      <p class="preview-toggle-note">Toggles mirror the adjustments reps apply for alternating cleans or front-only visits.</p>
      ${offerButtonBlock}
      <section class="result-panel preview-result-panel">
        <div class="result-box">
          <p class="result-price">Price per clean: <span data-preview-output="selectedPrice">${formatCurrency(0)}</span></p>
          <p class="preview-note" data-preview-breakdown></p>
          <p class="preview-minimum" data-preview-minimum></p>
        </div>
      </section>
      <section class="preview-schedule" data-preview-schedule>
        <h3>Upcoming Cleaning Dates</h3>
        <div class="preview-schedule-grid" data-preview-schedule-grid></div>
        <p class="preview-schedule-message" data-preview-schedule-message></p>
      </section>
      ${ctaBlock}
    </section>
  `;

  elements.interactivePreviewBody.innerHTML = bodyHtml;
  applyPreviewTheme();
  setupInteractivePreviewControls(mode);
  updatePreviewToggleUi();
}

function updatePreviewToggleUi() {
  if (!elements.previewToggleGroup) return;
  const mode = state.previewMode === "team" ? "team" : "customer";
  elements.previewToggleGroup.querySelectorAll("[data-preview-mode]").forEach((button) => {
    const isActive = button.dataset.previewMode === mode;
    button.classList.toggle("is-active", isActive);
  });
}

function setupInteractivePreviewControls(mode) {
  const container = elements.interactivePreviewBody;
  if (!container) return;
  const form = container.querySelector("[data-preview-form]");
  if (!form) return;
  const scheduleGrid = container.querySelector("[data-preview-schedule-grid]");
  const scheduleMessage = container.querySelector("[data-preview-schedule-message]");

  const toggles = state.settings.toggles || {};
  const pricing = state.settings.pricing || {};
  const tiers = state.settings.tiers || {};

  const selectedOutput = form.querySelector('[data-preview-output="selectedPrice"]');
  const silverOutput = form.querySelector('[data-preview-output="silverPrice"]');
  const goldOutput = form.querySelector('[data-preview-output="goldPrice"]');
  const breakdownLine = form.querySelector("[data-preview-breakdown]");
  const minimumLine = form.querySelector("[data-preview-minimum]");

  if (minimumLine) {
    const minimum = Number(pricing.minimum ?? 0);
    minimumLine.textContent = `Minimum clean price currently ${formatCurrency(minimum)}. Applied automatically if calculations fall below this level.`;
  }

  function sanitizeCount(field) {
    if (!field) return 0;
    const parsed = Math.max(0, Math.floor(Number(field.value || 0)));
    if (Number(field.value) !== parsed) {
      field.value = String(parsed);
    }
    return parsed;
  }

  function collectState() {
    const tierSelect = form.querySelector('[data-preview-input="tier"]');
    const tier = tierSelect?.value === "gold" ? "gold" : "silver";
    const size = form.querySelector('[data-preview-input="propertySize"]')?.value || "3 bed";
    const houseType = form.querySelector('[data-preview-input="houseType"]')?.value || "Semi-Detached";
    const frequencySelect = form.querySelector('[data-preview-input="frequency"]');
    const frequency = frequencySelect?.value || frequencyOptions[0] || "Every 4 weeks";
    const roofField = form.querySelector('[data-preview-quantity="roofLanterns"]');
    const skylightField = form.querySelector('[data-preview-quantity="skylights"]');
    return {
      tier,
      size,
      houseType,
      frequency,
      extras: {
        extension: form.querySelector('[data-preview-extra="extension"]')?.checked ?? false,
        conservatory: form.querySelector('[data-preview-extra="conservatory"]')?.checked ?? false,
        roofLanterns: sanitizeCount(roofField),
        skylights: sanitizeCount(skylightField),
      },
      alternating: form.querySelector('[data-preview-toggle="alternating"]')?.checked ?? false,
      frontOnly: form.querySelector('[data-preview-toggle="frontOnly"]')?.checked ?? false,
    };
  }

  function buildOptions(formState) {
    return {
      extension: formState.extras.extension,
      conservatory: formState.extras.conservatory,
      roofLanterns: formState.extras.roofLanterns,
      skylights: formState.extras.skylights,
      alternating: toggles.enableAlternating && formState.alternating,
      frontOnly: toggles.enableFrontOnly && formState.frontOnly,
    };
  }

  function updateQuantityBadges(formState) {
    const mapping = {
      roofLanterns: formState.extras.roofLanterns,
      skylights: formState.extras.skylights,
    };
    Object.entries(mapping).forEach(([key, value]) => {
      const badge = form.querySelector(`[data-preview-quantity-output="${key}"]`);
      if (badge) badge.textContent = String(value);
    });
  }

  function renderSchedulePreview(formState) {
    if (!scheduleGrid) return;
    const intervalDays = Math.max(1, resolveFrequencyDays(formState.frequency) || 28);
    const today = new Date();
    const occurrences = [0, intervalDays, intervalDays * 2].map((offset) => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      return date;
    });
    scheduleGrid.innerHTML = occurrences
      .map((date, index) => {
        const label = index === 0 ? "First clean" : `Clean ${index + 1}`;
        return `
          <div class="preview-schedule-card">
            <span class="preview-schedule-label">${label}</span>
            <strong>${formatScheduleDate(date)}</strong>
            <span>Repeats every ${escapeHtml(formState.frequency)}</span>
          </div>
        `;
      })
      .join("");
    if (scheduleMessage) {
      scheduleMessage.textContent = `We'll repeat this visit every ${formState.frequency}.`;
    }
  }

  function describeSelection(formState, opts) {
    const planLabel = formState.tier === "gold" ? tiers.gold?.label || "Gold" : tiers.silver?.label || "Silver";
    const descriptionParts = [
      `Plan: ${planLabel}`,
      `Size: ${formState.size}`,
      `Type: ${formState.houseType}`,
      `Frequency: ${formState.frequency}`,
    ];

    const extrasParts = [];
    if (opts.extension) extrasParts.push("Extension");
    if (opts.conservatory) extrasParts.push("Conservatory");
    if (Number(opts.roofLanterns) > 0) extrasParts.push(`${opts.roofLanterns} roof lantern${opts.roofLanterns === 1 ? "" : "s"}`);
    if (Number(opts.skylights) > 0) extrasParts.push(`${opts.skylights} skylight${opts.skylights === 1 ? "" : "s"}`);
    if (opts.alternating) extrasParts.push("Front/back alternating rotation");
    if (opts.frontOnly) extrasParts.push("Front-only adjustment");

    descriptionParts.push(extrasParts.length ? `Extras: ${extrasParts.join(", ")}` : "Extras: none selected");
    return descriptionParts.join(" • ");
  }

  function updateOutputs() {
    const formState = collectState();
    const opts = buildOptions(formState);
    const selectedPriceValue = computePriceSample({ tier: formState.tier, size: formState.size, houseType: formState.houseType, opts });
    const silverPriceValue = computePriceSample({ tier: "silver", size: formState.size, houseType: formState.houseType, opts });
    const goldPriceValue = computePriceSample({ tier: "gold", size: formState.size, houseType: formState.houseType, opts });

    if (selectedOutput) selectedOutput.textContent = formatCurrency(selectedPriceValue);
    if (silverOutput) silverOutput.textContent = formatCurrency(silverPriceValue);
    if (goldOutput) goldOutput.textContent = formatCurrency(goldPriceValue);
    if (breakdownLine) breakdownLine.textContent = describeSelection(formState, opts);
    updateQuantityBadges(formState);
    renderSchedulePreview(formState);
  }

  form.querySelectorAll("input, select").forEach((input) => {
    const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, updateOutputs);
  });

  updateOutputs();
}

async function loadSettings() {
  if (!state.subscriberId) return;
  try {
    const docRef = tenantDoc(db, state.subscriberId, "private", "addCustomerSettings");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      state.settings = deepMerge(clone(DEFAULT_SETTINGS), data);
      state.settings.frequencyOptions = ensureFrequencyOptions(state.settings.frequencyOptions);
      if (data.updatedAt?.toDate) {
        const savedDate = data.updatedAt.toDate();
        updateSavedBadge(savedDate);
      } else if (elements.updateBadge) {
        elements.updateBadge.hidden = true;
      }
    } else {
      state.settings = clone(DEFAULT_SETTINGS);
      state.settings.frequencyOptions = ensureFrequencyOptions(state.settings.frequencyOptions);
      elements.updateBadge.hidden = true;
    }
    applySettingsToInputs();
    updatePreviews();
    clearDirtyStatus("Loaded");
  } catch (error) {
    console.error("[AddCustomerSettings] Failed to load settings", error);
    if (elements.saveStatus) {
      elements.saveStatus.textContent = error?.message || "Unable to load settings";
      elements.saveStatus.style.color = "#b91c1c";
    }
  }
}

function updateSavedBadge(date) {
  if (!elements.updateBadge || !elements.updateBadgeTime) return;
  elements.updateBadge.hidden = false;
  elements.updateBadgeTime.textContent = formatRelativeTime(date);
  if (relativeTimer) clearInterval(relativeTimer);
  relativeTimer = window.setInterval(() => {
    elements.updateBadgeTime.textContent = formatRelativeTime(date);
  }, 60000);
}

async function handleSave() {
  if (!state.subscriberId) return;
  elements.saveBtn.disabled = true;
  elements.saveStatus.textContent = "Saving...";
  elements.saveStatus.style.color = "#64748b";
  try {
    const payload = { ...state.settings, updatedAt: serverTimestamp() };
    const docRef = tenantDoc(db, state.subscriberId, "private", "addCustomerSettings");
    await setDoc(docRef, payload, { merge: true });
    clearDirtyStatus();
    state.dirty = false;
    updateSavedBadge(new Date());
  } catch (error) {
    console.error("[AddCustomerSettings] Save failed", error);
    elements.saveStatus.textContent = error?.message || "Unable to save settings";
    elements.saveStatus.style.color = "#b91c1c";
  } finally {
    elements.saveBtn.disabled = false;
  }
}

async function handleReset() {
  const confirmReset = window.confirm("Restore factory defaults for the quote engine?");
  if (!confirmReset) return;
  state.settings = clone(DEFAULT_SETTINGS);
  state.settings.frequencyOptions = ensureFrequencyOptions(state.settings.frequencyOptions);
  applySettingsToInputs();
  updatePreviews();
  markDirty();
}

function handleCopy(textarea) {
  if (!navigator.clipboard) {
    textarea.select();
    document.execCommand("copy");
    return;
  }
  navigator.clipboard.writeText(textarea.value).catch(() => {
    textarea.select();
    document.execCommand("copy");
  });
}

function applyReadOnlyMode() {
  const editable = state.viewerRole === "subscriber" || state.viewerRole === "admin";
  if (editable) return;
  document.querySelectorAll("[data-setting-path]").forEach((field) => {
    field.setAttribute("disabled", "true");
  });
  elements.saveBtn?.setAttribute("disabled", "true");
  elements.resetBtn?.setAttribute("disabled", "true");
  elements.suggestPricingBtn?.setAttribute("disabled", "true");
  if (elements.saveStatus) {
    elements.saveStatus.textContent = "Read-only access";
    elements.saveStatus.style.color = "#64748b";
  }
}

function applySuggestedPricingPreset() {
  const rawValue = Number.parseFloat(elements.minimumPrice?.value || "");
  const currentMin = Number(state.settings?.pricing?.minimum ?? 16);
  const base = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : currentMin;
  const sanitizedMin = roundCurrency(Math.max(base, 0));

  setPath(state.settings, "pricing.minimum", sanitizedMin);

  Object.entries(SIZE_MULTIPLIERS).forEach(([size, multiplier]) => {
    const value = roundCurrency(sanitizedMin * multiplier);
    setPath(state.settings, `pricing.baseBySize.${size}`, value);
  });

  const extensionAdd = roundCurrency(Math.max(sanitizedMin * 0.25, 0));
  const conservatoryAdd = roundCurrency(Math.max(sanitizedMin * 0.35, 0));
  const roofLanternEach = roundCurrency(Math.max(sanitizedMin * 0.6, 0));
  const skylightEach = roundCurrency(Math.max(sanitizedMin * 0.1, 0));
  setPath(state.settings, "pricing.extensionAdd", extensionAdd);
  setPath(state.settings, "pricing.conservatoryAdd", conservatoryAdd);
  setPath(state.settings, "pricing.roofLanternEach", roofLanternEach);
  setPath(state.settings, "pricing.skylightEach", skylightEach);
  setPath(state.settings, "pricing.alternatingFactor", roundCurrency(0.5));
  setPath(state.settings, "pricing.frontOnlyFactor", roundCurrency(0.62));

  Object.entries(HOUSE_TYPE_PRESET).forEach(([type, multiplier]) => {
    setPath(state.settings, `houseTypeMultipliers.${type}`, roundCurrency(multiplier));
  });

  applySettingsToInputs();
  updatePreviews();
  markDirty();
  if (elements.saveStatus) {
    elements.saveStatus.textContent = "Suggested pricing applied";
    elements.saveStatus.style.color = "#0369a1";
  }

  flashNode(elements.minimumPrice);
  flashNode(document.getElementById("sizePricingTable"));
  flashNode(document.getElementById("pricingExtrasStart"));
}

function helperStorageKey() {
  const userId = state.viewerProfile?.id || state.viewerProfile?.uid || null;
  return userId ? `swash:addCustomerSettings:helper:${userId}` : null;
}

function markHelperDismissed() {
  const key = helperStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, "1");
  } catch (_) {
    /* ignore */
  }
}

function helperWasDismissed() {
  const key = helperStorageKey();
  if (!key) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch (_) {
    return false;
  }
}

function showHelperIfNeeded() {
  if (!elements.helperGuide) return;
  if (helperWasDismissed()) {
    elements.helperGuide.hidden = true;
    return;
  }
  elements.helperGuide.hidden = false;
  markHelperDismissed();
}

function dismissHelper() {
  if (!elements.helperGuide) return;
  elements.helperGuide.hidden = true;
  markHelperDismissed();
}

function initHelperGuide() {
  if (helperInitialised || !elements.helperGuide) return;
  helperInitialised = true;

  elements.helperGuide.addEventListener("click", (event) => {
    const dismissBtn = event.target.closest("[data-helper-dismiss]");
    if (dismissBtn) {
      dismissHelper();
      return;
    }
    const focusTrigger = event.target.closest("[data-focus-target]");
    if (focusTrigger) {
      const targetId = focusTrigger.dataset.focusTarget;
      focusAndHighlight(targetId);
    }
  });

  showHelperIfNeeded();
}

function initUiHandlers() {
  elements.logoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "./subscriber-login.html";
  });

  elements.saveBtn?.addEventListener("click", handleSave);
  elements.resetBtn?.addEventListener("click", handleReset);
  elements.suggestPricingBtn?.addEventListener("click", applySuggestedPricingPreset);
  elements.previewToggleGroup?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preview-mode]");
    if (!button) return;
    const mode = button.dataset.previewMode === "team" ? "team" : "customer";
    if (mode === state.previewMode) return;
    state.previewMode = mode;
    renderInteractivePreview();
  });
  elements.copyWebsiteBtn?.addEventListener("click", () => {
    if (elements.websiteSnippet) {
      handleCopy(elements.websiteSnippet);
      if (elements.saveStatus) {
        elements.saveStatus.textContent = "Website embed copied";
        elements.saveStatus.style.color = "#64748b";
      }
    }
  });
  elements.copyInternalBtn?.addEventListener("click", () => {
    if (elements.internalSnippet) {
      handleCopy(elements.internalSnippet);
      if (elements.saveStatus) {
        elements.saveStatus.textContent = "Internal embed copied";
        elements.saveStatus.style.color = "#64748b";
      }
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function bootstrap(user) {
  const access = await ensureSubscriberAccess(user);
  state.viewerProfile = access.viewerProfile;
  state.viewerRole = access.viewerRole;
  state.subscriberId = access.subscriberId;

  if (elements.overlay) {
    elements.overlay.style.display = "none";
  }
  if (elements.page) {
    elements.page.style.display = "block";
  }

  applySettingsToInputs();
  attachFieldListeners();
  applyReadOnlyMode();
  await loadSettings();
  initHelperGuide();
}

function start() {
  initUiHandlers();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./subscriber-login.html";
      return;
    }
    try {
      await bootstrap(user);
    } catch (error) {
      console.error("[AddCustomerSettings] bootstrap failed", error);
      alert(error?.message || "Unable to load subscriber settings");
      await signOut(auth);
      window.location.href = "./subscriber-login.html";
    }
  });
}

start();
