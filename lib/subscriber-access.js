import { db } from "../public/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const STORAGE_KEY = "swash:selected-subscriber";
const ACTIVE_NAME_KEY = "swashActiveSubscriberName";

function persistSubscriberName(name) {
  try {
    if (name) {
      sessionStorage.setItem(ACTIVE_NAME_KEY, name);
      localStorage.setItem(ACTIVE_NAME_KEY, name);
    } else {
      sessionStorage.removeItem(ACTIVE_NAME_KEY);
      localStorage.removeItem(ACTIVE_NAME_KEY);
    }
  } catch (_) {
    /* ignore */
  }
}

function updateHeaderCompanyName(name) {
  const headerLeft = document.querySelector(".header-left");
  if (!headerLeft) return;
  let chip = headerLeft.querySelector("[data-company-name]");
  if (!chip && name) {
    chip = document.createElement("span");
    chip.className = "header-company";
    chip.dataset.companyName = "";
    const logo = headerLeft.querySelector(".header-logo");
    if (logo && logo.parentElement === headerLeft) {
      headerLeft.insertBefore(chip, logo.nextSibling);
    } else {
      headerLeft.insertBefore(chip, headerLeft.firstChild);
    }
  }

  if (chip) {
    if (name) {
      chip.textContent = name;
      chip.hidden = false;
    } else {
      chip.textContent = "";
      chip.hidden = true;
    }
  }
}

function ensureOverlay() {
  let overlay = document.getElementById("authOverlay");
  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "authOverlay";
    overlay.className = "auth-overlay";
    document.body.prepend(overlay);
  }
  overlay.hidden = false;
  overlay.style.display = "flex";
  return overlay;
}

function hideOverlay(overlay) {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.style.display = "none";
}

async function fetchSubscribers() {
  const ref = collection(db, "users");
  const snap = await getDocs(query(ref, where("role", "==", "subscriber")));
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => {
      const nameA = String(a.companyName || a.name || a.email || a.id).toLowerCase();
      const nameB = String(b.companyName || b.name || b.email || b.id).toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });
}

function renderSubscriberList(listEl, subscribers, resolve) {
  if (!subscribers.length) {
    listEl.innerHTML = '<div class="subscriber-picker__empty">No subscribers were found. Add a subscriber account first.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  subscribers.forEach((subscriber) => {
    const item = document.createElement("div");
    item.className = "subscriber-picker__item";

    const copyWrap = document.createElement("div");
    copyWrap.style.display = "flex";
    copyWrap.style.flexDirection = "column";
    copyWrap.style.gap = "4px";

    const nameEl = document.createElement("span");
    nameEl.className = "subscriber-picker__name";
    nameEl.textContent = subscriber.companyName || subscriber.name || subscriber.email || subscriber.id;
    copyWrap.appendChild(nameEl);

    if (subscriber.territoryName || subscriber.email) {
      const meta = document.createElement("span");
      meta.className = "subscriber-picker__meta";
      const parts = [];
      if (subscriber.territoryName) parts.push(subscriber.territoryName);
      if (subscriber.email) parts.push(subscriber.email);
      meta.textContent = parts.join(" • ");
      copyWrap.appendChild(meta);
    }

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "subscriber-picker__button";
    selectBtn.textContent = "Open";
    selectBtn.addEventListener("click", () => resolve(subscriber.id));

    item.append(copyWrap, selectBtn);
    fragment.appendChild(item);
  });

  listEl.innerHTML = "";
  listEl.appendChild(fragment);
}

async function promptAdminForSubscriber() {
  const overlay = ensureOverlay();
  overlay.innerHTML = `
    <div class="auth-card auth-card--subscriber-picker">
      <div class="subscriber-picker">
        <header>
          <h2 style="margin:0 0 6px 0;">Select a subscriber</h2>
          <p class="text-muted" style="margin:0;">Pick the subscriber workspace you want to open. You can change this later from any subscriber page.</p>
        </header>
        <div data-subscriber-list class="subscriber-picker__list">
          <div class="subscriber-picker__empty">Loading subscribers…</div>
        </div>
        <button type="button" class="btn btn-secondary" data-subscriber-clear>Clear stored selection</button>
      </div>
    </div>
  `;

  const listEl = overlay.querySelector("[data-subscriber-list]");
  const clearBtn = overlay.querySelector("[data-subscriber-clear]");

  const subscribers = await fetchSubscribers().catch((error) => {
    console.warn("[SubscriberAccess] Failed to load subscribers", error);
    return [];
  });

  return new Promise((resolve) => {
    renderSubscriberList(listEl, subscribers, (selectedId) => {
      hideOverlay(overlay);
      resolve({ subscriberId: selectedId, overlay });
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_KEY);
        } catch (_) {
          /* ignore */
        }
        renderSubscriberList(listEl, subscribers, (selectedId) => {
          hideOverlay(overlay);
          resolve({ subscriberId: selectedId, overlay });
        });
      });
    }
  });
}

export async function ensureSubscriberAccess(user) {
  if (!user) throw new Error("User is not signed in");

  const overlay = document.getElementById("authOverlay");
  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) throw new Error("User profile not found");

  const userData = { id: userSnap.id, ...userSnap.data() };
  const params = new URLSearchParams(window.location.search);
  let subscriberId = params.get("uid") || params.get("subscriberId");

  if (userData.role === "subscriber") {
    subscriberId = user.uid;
  }

  if (userData.role === "admin") {
    if (!subscriberId) {
      try {
        subscriberId = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || "";
      } catch (_) {
        subscriberId = "";
      }
    }
    if (!subscriberId) {
      const { subscriberId: selectedId } = await promptAdminForSubscriber();
      subscriberId = selectedId || "";
    }
    if (subscriberId) {
      try {
        sessionStorage.setItem(STORAGE_KEY, subscriberId);
      } catch (_) {
        /* ignore */
      }
    }
  }

  if (!subscriberId) {
    persistSubscriberName("");
    updateHeaderCompanyName("");
    hideOverlay(overlay);
    throw new Error("No subscriber selected");
  }

  const subscriberSnap = await getDoc(doc(db, "users", subscriberId));
  if (!subscriberSnap.exists()) {
    persistSubscriberName("");
    updateHeaderCompanyName("");
    hideOverlay(overlay);
    throw new Error("Subscriber not found");
  }

  const subscriberProfile = { id: subscriberSnap.id, ...subscriberSnap.data() };
  const companyName = subscriberProfile.companyName || subscriberProfile.name || subscriberProfile.territoryName || subscriberProfile.email || "";
  persistSubscriberName(companyName);
  updateHeaderCompanyName(companyName);

  if (typeof window !== "undefined") {
    window.activeSubscriberProfile = subscriberProfile;
    window.dispatchEvent(new CustomEvent("swash:subscriber-profile", {
      detail: {
        id: subscriberId,
        name: companyName,
        profile: subscriberProfile,
      },
    }));
  }

  hideOverlay(overlay);

  return {
    viewerProfile: userData,
    viewerRole: userData.role,
    subscriberId,
    subscriberProfile,
  };
}

export function clearStoredSubscriber() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(ACTIVE_NAME_KEY);
    localStorage.removeItem(ACTIVE_NAME_KEY);
  } catch (_) {
    /* ignore */
  }
  updateHeaderCompanyName("");
}
