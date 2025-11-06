// Role-based menu visibility and access control
// Works across pages; initializes Firebase app if needed using the same config.

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
const adminOnly = ["admin-dashboard-link", "schedule-link", "quotes-link", "manage-users-link"];
const loginLink = "login-link";

console.log("[Auth] auth-check.js module loaded");
console.log("[Auth] Initialising");

const REDIRECT_DELAY_MS = 200;

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

const PAGE_TYPE = (() => {
  const path = (window.location && window.location.pathname) || "/";
  if (/\/(index|index-login)\.html?$/.test(path) || path === "/") return "login";
  if (/\/rep\/login\.html$/.test(path)) return "login";

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
    if (role !== "rep") {
      status.redirected = scheduleRedirect(loginUrl);
      return status;
    }
    console.log("[Auth] Role matches rep, staying on page");
    return status;
  }

  return status;
}

function attachLogoutListener() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn || logoutListenerAttached) return;
  logoutListenerAttached = true;
  logoutBtn.addEventListener("click", () => {
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

    const overlay = document.getElementById("authOverlay");
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = "flex";
    }

    authStateManager.resolveReady(null, "unauthorised");
    if (PAGE_TYPE && PAGE_TYPE !== "login") {
      await handlePageRouting(PAGE_TYPE);
    }
    return;
  }

  console.log(`[Auth] User: ${user.email}`);

  let role = "unauthorised";
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    role = snap.exists() ? (snap.data().role || "rep") : "unauthorised";
  } catch (error) {
    console.error("Failed to load user role", error);
    role = "unauthorised";
  }

  authStateManager.state.role = role;
  window.userRole = role;
  console.log(`[Auth] Role: ${role}`);

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
  } else {
    hideAllMenuItems();
  }

  authStateManager.resolveReady(user, role);

  if (PAGE_TYPE) {
    await handlePageRouting(PAGE_TYPE);
  }
});
