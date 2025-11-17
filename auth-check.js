// Role-based menu visibility and access control
// Works across pages; initializes Firebase app if needed using the same config.

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Cache last known role locally so we can tolerate offline role fetch failures
const ROLE_CACHE_KEY = 'swash:lastRole';
function loadCachedRole() {
  try { return localStorage.getItem(ROLE_CACHE_KEY) || null; } catch(_) { return null; }
}
function saveCachedRole(role) {
  try { localStorage.setItem(ROLE_CACHE_KEY, role); } catch(_) {}
}

// NOTE: This project does not have a shared config.js. We inline the config and reuse an existing app if present.
const firebaseConfig = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};

// All duplicate Firebase config and initialization blocks removed

// Menu IDs per role
// Visible to both admins and reps
const bothRoles = ["add-customer-link"];
// Visible to reps only
const repOnly = ["rep-home-link"];
// Visible to admins only
const adminOnly = [
  "admin-dashboard-link",
  "stats-link",
  "schedule-link",
  "quotes-link",
  "manage-users-link",
  "message-log-link",
  "admin-tracking-link",
  "add-new-customer-link"
];
const loginLink = "login-link";

console.log("[Auth] auth-check.js module loaded");
console.log("[Auth] Initialising");

// Detect embed mode (iframe or explicit query string) to suppress redirects inside modals/embeds
const IS_EMBED = (() => {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("embed") === "true" || (window.self !== window.top);
  } catch (_) {
    return false;
  }
})();

const REDIRECT_DELAY_MS = 200;
// Grace period to let Firebase restore sessions before redirecting away from app pages
const HANDSHAKE_GRACE_MS = 1500;

const authStateManager = (() => {
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const state = {
    user: null,
    role: "unauthorised",
    ready: false,
    isRedirecting: false,
    currentUid: null,
    lastRedirectTarget: null,
  };

  const listeners = new Set();

  return {
    state,
    resolveReady(user, role) {
      if (!state.ready) {
        state.ready = true;
        resolveReady({ user, role });
      }
      listeners.forEach((listener) => {
        try {
          listener({ user, role });
        } catch (error) {
          console.warn("[Auth] Listener error", error);
        }
      });
    },
    async authStateReady() {
      if (state.ready) {
        return { user: state.user, role: state.role };
      }
      return readyPromise;
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      if (state.ready) {
        try {
          listener({ user: state.user, role: state.role });
        } catch (error) {
          console.warn("[Auth] Listener error", error);
        }
      }
      return () => listeners.delete(listener);
    },
  };
})();

export function authStateReady() {
  return authStateManager.authStateReady();
}

export function onAuthStateChange(listener) {
  return authStateManager.subscribe(listener);
}

// Expose for modules that need to react after auth resolves without importing
if (typeof window !== "undefined") {
  window.onAuthStateChange = onAuthStateChange;
}

const PAGE_TYPE = (() => {
  const path = (window.location && window.location.pathname) || "/";
  if (/\/(index|index-login)\.html?$/.test(path) || path === "/") return "login";
  if (/\/rep\/login\.html$/.test(path)) return "login";
  if (/\/subscriber-login\.html$/.test(path)) return "subscriber-login";

  // Subscriber pages - completely separate auth system
  if (/\/subscriber-/.test(path)) return "subscriber";

  if (/\/admin\.html$/.test(path) || /\/admin\//.test(path)) return "admin";
  if (/\/rep\/scheduler\.html$/.test(path)) return "shared";

  if (/\/rep\/quote\.html$/.test(path)) return "shared";
  if (/\/rep\/rep-home\.html$/.test(path)) return "shared";

  if (/\/add-log\.html$/.test(path)) return "rep";
  if (/\/rep\/rep-dashboard\.html$/.test(path)) return "rep";
  if (/\/rep\//.test(path)) return "rep";

  return null;
})();

console.log("[Auth] Awaiting Firebase auth...");

async function ensureUserProfile(user) {
  if (!user) return null;
  const ref = doc(db, "users", user.uid);
  try {
    let snap = await getDoc(ref);
    if (snap.exists()) return snap;
    const payload = {
      role: "rep",
      email: user.email || "",
      displayName: user.displayName || user.email || "",
      repName: user.displayName || user.email || "",
      autoProvisioned: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(ref, payload, { merge: true });
    snap = await getDoc(ref);
    return snap;
  } catch (err) {
    console.warn("[Auth] Failed to auto-provision user profile", err?.message || err);
    return null;
  }
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", hidden);
}

function hideAllMenuItems() {
  repOnly.forEach((id) => setHidden(id, true));
  adminOnly.forEach((id) => setHidden(id, true));
  bothRoles.forEach((id) => setHidden(id, true));
  setHidden(loginLink, false); // Show login link when not logged in
}

function showRepMenu() {
  repOnly.forEach((id) => setHidden(id, false));
  adminOnly.forEach((id) => setHidden(id, true));
  bothRoles.forEach((id) => setHidden(id, false));
  setHidden(loginLink, true); // Hide login link when logged in
}

function showAdminMenu() {
  repOnly.concat(adminOnly).forEach((id) => setHidden(id, false));
  bothRoles.forEach((id) => setHidden(id, false));
  setHidden(loginLink, true); // Hide login link when logged in
}

function redirectToLogin() {
  // This app uses an inline login overlay on most pages; if present, reveal it.
  const overlay = document.getElementById("authOverlay");
  console.log("[Auth] redirectToLogin called. authOverlay element found?", !!overlay);
  if (overlay) {
    overlay.hidden = false;
    overlay.style.display = "flex";
    console.log("[Auth] Showing authOverlay");
    return;
  }
  // Redirect to dedicated login page
  const { pathname, search, hash } = window.location;
  const here = encodeURIComponent(`${pathname}${search || ""}${hash || ""}`);
  const url = `/index.html${pathname !== "/" ? `?redirect=${here}` : ""}`;
  scheduleRedirect(url);
}

let logoutListenerAttached = false;
let redirectTimer = null;
let pendingLoginRedirectTimer = null;

function normalisePath(targetUrl) {
  try {
    return new URL(targetUrl, window.location.origin).pathname;
  } catch (_) {
    return targetUrl;
  }
}

function markRedirect(targetUrl) {
  authStateManager.state.isRedirecting = true;
  authStateManager.state.lastRedirectTarget = normalisePath(targetUrl);
}

function canRedirect(targetUrl) {
  const targetPath = normalisePath(targetUrl);
  const currentPath = window.location.pathname;
  if (!targetUrl) return false;
  if (targetPath === currentPath) {
    console.log("[Auth] Suppressed duplicate redirect (already on target path)");
    return false;
  }
  if (authStateManager.state.isRedirecting) {
    console.log("[Auth] Suppressed duplicate redirect (already redirecting)");
    return false;
  }
  if (authStateManager.state.lastRedirectTarget === targetPath) {
    console.log("[Auth] Suppressed duplicate redirect (same target)");
    return false;
  }
  return true;
}

function scheduleRedirect(targetUrl) {
  if (!canRedirect(targetUrl)) return false;
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
  markRedirect(targetUrl);
  redirectTimer = setTimeout(() => {
    console.log(`[Auth] Redirect → ${targetUrl}`);
    try {
      window.location.replace(targetUrl);
    } catch (_) {
      window.location.href = targetUrl;
    }
  }, REDIRECT_DELAY_MS);
  return true;
}

export async function handlePageRouting(pageType = "login") {
  const { user, role } = await authStateReady();
  const status = { user, role, redirected: false };
  const loginUrl = "/index.html";

  // In embed mode, never redirect — embedded pages should render in-place.
  if (IS_EMBED) {
    console.log("[Auth] Embed mode active — skipping routing/redirects");
    return status;
  }

  // Subscriber pages use completely separate authentication - skip all routing
  if (pageType === "subscriber" || pageType === "subscriber-login") {
    console.log("[Auth] Subscriber page detected - using separate auth system");
    return status;
  }

  if (pageType === "login") {
    if (!user) return status;
    if (role === "admin") {
      status.redirected = scheduleRedirect("/admin.html");
      return status;
    }
    if (role === "rep") {
      status.redirected = scheduleRedirect("/rep/rep-home.html");
      return status;
    }
    if (role === "subscriber") {
      status.redirected = scheduleRedirect("/subscriber-dashboard.html");
      return status;
    }
    return status;
  }

  if (!user) {
    status.redirected = scheduleRedirect(loginUrl);
    return status;
  }

  if (pageType === "shared") {
    console.log("[Auth] Shared page access granted");
    return status;
  }

  if (pageType === "admin") {
    if (role !== "admin") {
      status.redirected = scheduleRedirect(loginUrl);
      return status;
    }
    console.log("[Auth] Role matches admin, staying on page");
    return status;
  }

  if (pageType === "rep") {
    if (role !== "rep" && role !== "admin") {
      status.redirected = scheduleRedirect(loginUrl);
      return status;
    }
    console.log("[Auth] Role matches rep-access, staying on page");
    return status;
  }

  return status;
}

function attachLogoutListener() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn || logoutListenerAttached) return;
  logoutListenerAttached = true;
  logoutBtn.addEventListener("click", async () => {
    // Check if there's an active shift that needs to be ended (rep-log.js specific)
    if (typeof window.endShiftBeforeLogout === 'function') {
      try {
        await window.endShiftBeforeLogout();
      } catch(e) {
        console.warn('Failed to auto-end shift on logout', e);
      }
    }
    signOut(auth)
      .then(() => {
        scheduleRedirect("/index.html");
      })
      .catch((error) => {
        console.warn("Sign out failed", error);
      });
  });
  logoutBtn.removeAttribute("hidden");
}

onAuthStateChanged(auth, async (user) => {
  const previousUid = authStateManager.state.currentUid;
  const nextUid = user?.uid || null;
  if (previousUid !== nextUid) {
    authStateManager.state.isRedirecting = false;
    authStateManager.state.lastRedirectTarget = null;
  }

  authStateManager.state.user = user || null;
  authStateManager.state.currentUid = nextUid;

  if (!user) {
    console.log("[Auth] User: none");
    authStateManager.state.role = "unauthorised";
    window.userRole = undefined;
    hideAllMenuItems();

    const offline = !navigator.onLine;
    const cachedRole = loadCachedRole();

    if (offline && (cachedRole === 'rep' || cachedRole === 'admin')) {
      console.log(`[Auth] Offline with cached role '${cachedRole}'. Allowing offline session.`);
      // Hide overlay if present and show appropriate menu
      const overlay = document.getElementById("authOverlay");
      if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
      if (cachedRole === 'admin') showAdminMenu(); else showRepMenu();

      authStateManager.state.role = cachedRole;
      window.userRole = cachedRole;
      // Resolve as ready with cached role; user remains null but pages can proceed
      authStateManager.resolveReady(null, cachedRole);
      // Do not schedule any redirects while offline
      return;
    }

    // In embed mode, do not surface full-screen overlays or redirect away
    if (!IS_EMBED) {
      const overlay = document.getElementById("authOverlay");
      if (overlay) {
        overlay.hidden = false;
        overlay.style.display = "flex";
      }
    }

    authStateManager.resolveReady(null, "unauthorised");
    // IMPORTANT: Avoid redirect loops while Firebase restores the session.
    // If no inline overlay exists, wait a short grace period before redirecting.
    if (!IS_EMBED && PAGE_TYPE && PAGE_TYPE !== "login") {
      const overlay = document.getElementById("authOverlay");
      if (!overlay) {
        if (pendingLoginRedirectTimer) {
          clearTimeout(pendingLoginRedirectTimer);
          pendingLoginRedirectTimer = null;
        }
        pendingLoginRedirectTimer = setTimeout(async () => {
          // Only redirect if still unauthorised
          if (!auth.currentUser) {
            // If offline, skip redirect to keep page usable
            if (!navigator.onLine) {
              console.log('[Auth] Offline unauthorised; skipping redirect to keep page open');
            } else {
              await handlePageRouting(PAGE_TYPE);
            }
          } else {
            console.log("[Auth] Session restored during grace; skip redirect");
          }
          pendingLoginRedirectTimer = null;
        }, HANDSHAKE_GRACE_MS);
      } else {
        console.log("[Auth] Overlay present; suppressing redirect until user signs in.");
      }
    }
    return;
  }

  console.log(`[Auth] User: ${user.email}`);

  let role = "unauthorised";
  try {
  const snap = await ensureUserProfile(user);
  role = snap && snap.exists() ? (snap.data().role || "rep") : "unauthorised";
    // Cache identity for offline use
    try {
      localStorage.setItem('swash:lastUid', user.uid);
      const repName = (snap && snap.exists() && (snap.data().repName || snap.data().name)) || user.displayName || user.email || '';
      if (repName) localStorage.setItem('swash:lastRepName', repName);
      const assignedTerritoryId = snap && snap.exists() ? (snap.data().assignedTerritoryId || snap.data().territoryId || '') : '';
      if (assignedTerritoryId) localStorage.setItem('swash:lastAssignedTerritoryId', assignedTerritoryId);
    } catch(_) {}
    // Successful fetch -> update cache
    if (role !== 'unauthorised') saveCachedRole(role);
  } catch (error) {
    console.warn("Failed to load user role (network?)", error?.message || error);
    // Use cached role if available (allows offline continuation)
    const cached = loadCachedRole();
    if (cached === 'rep' || cached === 'admin' || cached === 'subscriber') {
      role = cached;
      console.log(`[Auth] Using cached role '${cached}' due to fetch failure`);
    } else {
      role = "unauthorised";
    }
  }

  authStateManager.state.role = role;
  window.userRole = role;
  console.log(`[Auth] Role: ${role}`);

  // Cancel any pending delayed redirects now that we have a user
  if (pendingLoginRedirectTimer) {
    clearTimeout(pendingLoginRedirectTimer);
    pendingLoginRedirectTimer = null;
  }

  const overlay = document.getElementById("authOverlay");
  if (overlay) {
    overlay.hidden = true;
    overlay.style.display = "none";
  }

  attachLogoutListener();

  if (role === "admin") {
    showAdminMenu();
  } else if (role === "rep") {
    showRepMenu();
  } else if (role === "subscriber") {
    // Subscribers have their own pages with separate auth - don't manage menu here
    console.log("[Auth] Subscriber role detected - skipping menu management");
  } else {
    hideAllMenuItems();
  }

  authStateManager.resolveReady(user, role);

  if (!IS_EMBED && PAGE_TYPE) {
    // When offline and we only have a cached role, suppress forced redirects to login
    const offline = !navigator.onLine;
    if (offline) {
      console.log('[Auth] Offline detected; skipping routing redirects to preserve offline session');
    } else {
      await handlePageRouting(PAGE_TYPE);
    }
  }
});
