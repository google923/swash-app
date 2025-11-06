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
console.log('[Auth] Module loaded');

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
  const url = `./login.html${pathname !== "/" ? `?redirect=${here}` : ""}`;
  console.log("[Auth] No authOverlay found, redirecting to", url);
  window.location.href = url;
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "./index.html";
      return;
    }
    // Enable menu and sign-out button if present
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        signOut(auth).then(() => window.location.href = "./index.html");
      });
      logoutBtn.removeAttribute("hidden");
    }
    // ...menu setup logic...
  });
});

onAuthStateChanged(auth, async (user) => {
  console.log('[Auth] User detected:', user?.email || 'none');
  const path = (window.location && window.location.pathname) || "/";
  const isIndex = path === "/" || /\/(index\.html)?$/.test(path);
  const isAdminPage = /\/(admin\.html|scheduler\.html|admin\/users\.html)/.test(path);
  const isRepPage = /\/(rep-home\.html|rep-dashboard\.html|add-log\.html|quote\.html|rep\/)/.test(path);
  
  if (!user) {
    // Hide all authenticated menu items
    hideAllMenuItems();
    
    // Allow public access only on the index page
    if (isIndex) return;
    
    // Redirect all other pages to login
    redirectToLogin();
    return;
  }

  try {
    // Hide inline auth overlay if present now that we have a user
    const overlay = document.getElementById("authOverlay");
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = "none";
    }

    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "none";
    
    // Role-based page routing
    if (role === "rep") {
      // Redirect reps away from admin-only pages to Rep Home
      if (isAdminPage) {
        // Use a root-relative path so this works from subdirectories like /admin/users.html
        window.location.href = "/rep-home.html";
        return;
      }
      showRepMenu();
    } else if (role === "admin") {
      // Admins have full access to all pages - no redirects
      showAdminMenu();
    } else {
      alert("Access denied: unknown role.");
      hideAllMenuItems();
      redirectToLogin();
    }
  } catch (err) {
    console.error("Failed to load user role", err);
    alert("Access denied: unable to verify role.");
    hideAllMenuItems();
    redirectToLogin();
  }
});
