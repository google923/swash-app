// Global navigation, modal handlers, and admin-only Rep View toggle
// Requires auth-check.js to have set window.userRole

function qs(id) { return document.getElementById(id); }

const ROLE_LABELS = {
  admin: "Admin",
  rep: "Rep",
  subscriber: "Subscriber",
  guest: "Guest",
  unauthorised: "Guest",
};

const SUBSCRIBER_NAME_KEY = "swashActiveSubscriberName";

function formatRoleLabel(role) {
  if (!role) return ROLE_LABELS.guest;
  const key = role.toLowerCase();
  return ROLE_LABELS[key] || role.charAt(0).toUpperCase() + role.slice(1);
}

function loadStoredSubscriberName() {
  try {
    return sessionStorage.getItem(SUBSCRIBER_NAME_KEY) || localStorage.getItem(SUBSCRIBER_NAME_KEY) || "";
  } catch (_) {
    return "";
  }
}

function storeSubscriberName(name) {
  try {
    if (name) {
      sessionStorage.setItem(SUBSCRIBER_NAME_KEY, name);
      localStorage.setItem(SUBSCRIBER_NAME_KEY, name);
    } else {
      sessionStorage.removeItem(SUBSCRIBER_NAME_KEY);
      localStorage.removeItem(SUBSCRIBER_NAME_KEY);
    }
  } catch (_) {
    /* ignore */
  }
}

function setCompanyName(name) {
  const headerLeft = document.querySelector('.header-left');
  if (!headerLeft) return;

  let chip = headerLeft.querySelector('[data-company-name]');
  if (!chip && name) {
    chip = document.createElement('span');
    chip.className = 'header-company';
    chip.dataset.companyName = '';
    const logo = headerLeft.querySelector('.header-logo');
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
      chip.textContent = '';
      chip.hidden = true;
    }
  }
}

function handleSubscriberProfileEvent(event) {
  const detail = event?.detail || {};
  const name = detail.name || '';
  storeSubscriberName(name);
  setCompanyName(name);
}

function buildRoleBadge(role) {
  const resolvedRole = (role || "guest").toLowerCase();
  const badge = document.createElement("span");
  badge.className = "role-badge";
  badge.dataset.roleBadge = "";
  badge.dataset.role = resolvedRole;
  badge.innerHTML = 'Role: <strong data-role-label></strong>';
  const label = badge.querySelector('[data-role-label]');
  if (label) {
    label.textContent = formatRoleLabel(resolvedRole);
  }
  return badge;
}

function updateRoleBadge() {
  const role = (window.userRole || "guest").toLowerCase();
  const labelText = formatRoleLabel(role);
  const badges = document.querySelectorAll('[data-role-badge]');
  if (!badges.length) {
    const legacy = document.querySelector('[data-role-pill]');
    if (legacy) {
      legacy.removeAttribute('data-role-pill');
      legacy.classList.remove('role-pill');
      legacy.classList.add('role-badge');
      legacy.dataset.roleBadge = '';
      legacy.dataset.role = role;
      legacy.innerHTML = `Role: <strong data-role-label>${labelText}</strong>`;
      return;
    }
    return;
  }

  badges.forEach((badge, index) => {
    if (index > 0) {
      badge.remove();
      return;
    }
    badge.dataset.role = role;
    const label = badge.querySelector('[data-role-label]');
    if (label) label.textContent = labelText;
  });

  if (role === 'subscriber' || role === 'admin') {
    setCompanyName(loadStoredSubscriberName());
  } else {
    setCompanyName('');
    storeSubscriberName('');
  }
}

function ensureRoleBadge() {
  const header = document.querySelector('.header');
  if (!header) return;
  const headerActions = header.querySelector('.header-actions');
  if (!headerActions) return;

  header.querySelectorAll('.header-left [data-role-pill], .header-left .role-pill, .header-left .role-badge').forEach((node) => {
    node.remove();
  });

  let badge = headerActions.querySelector('[data-role-badge]');

  if (!badge) {
    const legacy = headerActions.querySelector('[data-role-pill]');
    if (legacy) {
      legacy.removeAttribute('data-role-pill');
      legacy.classList.remove('role-pill');
      legacy.classList.add('role-badge');
      legacy.dataset.roleBadge = '';
      legacy.dataset.role = (window.userRole || 'guest').toLowerCase();
      legacy.innerHTML = 'Role: <strong data-role-label></strong>';
      const label = legacy.querySelector('[data-role-label]');
      if (label) label.textContent = formatRoleLabel(window.userRole || 'guest');
      badge = legacy;
    }
  }

  if (!badge) {
    badge = buildRoleBadge((window.userRole || 'guest').toLowerCase());
    headerActions.insertBefore(badge, headerActions.firstChild || null);
  }

  const duplicates = headerActions.querySelectorAll('[data-role-badge]');
  duplicates.forEach((node, index) => {
    if (index === 0) return;
    node.remove();
  });

  const activeBadge = headerActions.querySelector('[data-role-badge]');
  if (activeBadge && activeBadge !== headerActions.firstElementChild) {
    headerActions.insertBefore(activeBadge, headerActions.firstElementChild);
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    headerActions.insertBefore(logoutBtn, activeBadge ? activeBadge.nextSibling : headerActions.firstChild);
  }

  headerActions.querySelectorAll('[data-role-pill]').forEach((node) => {
    node.remove();
  });

  const existingName = loadStoredSubscriberName();
  if (existingName) {
    setCompanyName(existingName);
  }
}

function initMenuDropdown() {
  const menuBtn = qs("menuBtn");
  const menuDropdown = qs("menuDropdown");
  if (!menuBtn) return;
  if (menuBtn.dataset.menuInit) return;
  menuBtn.dataset.menuInit = "1";

  // Replace dropdown with direct link into the main hub
  menuBtn.textContent = "Quick Actions";
  menuBtn.setAttribute("aria-haspopup", "false");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.addEventListener("click", () => {
    window.location.href = "/main.html";
  });

  // Remove dropdown markup to avoid hidden duplicate navigation
  if (menuDropdown) menuDropdown.remove();
  console.log("[Nav] Menu button redirects to main hub");
}

function applyRepViewFlag(enabled) {
  const body = document.body;
  if (!body) return;
  if (enabled) body.setAttribute("data-rep-view", "true");
  else body.removeAttribute("data-rep-view");

  // Hide/show admin menu items when in rep view
  const adminLinkIds = ["admin-dashboard-link", "scheduler-link", "rep-tracker-link", "stats-link", "user-settings-link", "add-new-customer-link"];
  adminLinkIds.forEach((id) => {
    const a = qs(id);
    if (!a) return;
    a.classList.toggle("hidden", !!enabled);
  });
}

function initRepViewToggle() {
  // Only admins see the toggle
  const role = window.userRole;
  const toggleWrap = qs("repViewToggle");
  const checkbox = qs("repViewCheckbox");
  if (!toggleWrap || !checkbox) return;
  if (role !== "admin") {
    toggleWrap.classList.add("hidden");
    return;
  }
  toggleWrap.classList.remove("hidden");

  const key = "swashRepView";
  const stored = sessionStorage.getItem(key) === "1";
  checkbox.checked = stored;
  applyRepViewFlag(stored);

  checkbox.addEventListener("change", () => {
    const enabled = checkbox.checked;
    sessionStorage.setItem(key, enabled ? "1" : "0");
    applyRepViewFlag(enabled);
    console.log(enabled ? "[RepView] Enabled" : "[RepView] Disabled");
    // If toggled on while on admin page, take user to rep home to mirror their view
    const isRepPage = location.pathname.includes("/rep/");
    if (enabled && !isRepPage) {
      location.href = "/rep/rep-home.html";
    }
    if (!enabled && isRepPage) {
      // Return to admin dashboard when disabling rep view on rep pages
      location.href = "/pipeline.html";
    }
  });
  
  // Subscribe to auth changes to re-show/hide toggle as needed
  if (typeof window.onAuthStateChange === "function") {
    try {
      window.onAuthStateChange(() => {
        const updatedRole = window.userRole;
        if (updatedRole === "admin") {
          toggleWrap.classList.remove("hidden");
        } else {
          toggleWrap.classList.add("hidden");
        }
      });
    } catch (e) {
      console.warn("[Nav] Failed to subscribe to auth changes", e);
    }
  }
}

// Generic modal open/close via data attributes
function findModal(el) {
  return el.closest(".modal") || qs(el.getAttribute("data-modal-target")) || null;
}

function initModalHandlers() {
  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-modal-open]");
    if (openBtn) {
      const targetId = openBtn.getAttribute("data-modal-open");
      const modal = qs(targetId) || qs(openBtn.getAttribute("data-modal-target"));
      if (modal) {
        modal.hidden = false;
        modal.style.display = "flex";
        console.log("[Modal] Open", targetId || modal.id || "(unknown)");
      }
      return;
    }
    const closeBtn = e.target.closest("[data-modal-close], .modal__close");
    if (closeBtn) {
      const modal = closeBtn.getAttribute("data-modal-close")
        ? qs(closeBtn.getAttribute("data-modal-close"))
        : findModal(closeBtn);
      if (modal) {
        modal.hidden = true;
        modal.style.display = "none";
        console.log("[Modal] Close", modal.id || "(unknown)");
      }
      return;
    }
    const backBtn = e.target.closest("[data-back]");
    if (backBtn) {
      const fallback = backBtn.getAttribute("data-fallback") || (window.userRole === "admin" ? "/pipeline.html" : "/rep/rep-home.html");
      if (history.length > 1) history.back();
      else location.href = fallback;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal:not([hidden])").forEach((m) => {
        m.hidden = true; m.style.display = "none";
      });
    }
  });
}

function updateMenuVisibility() {
  const role = window.userRole;
  const isRepPage = location.pathname.includes("/rep/rep-home") || 
                    location.pathname.includes("/rep/rep-log") ||
                    location.pathname.includes("/rep/map") ||
                    location.pathname.includes("/rep/chat") ||
                    location.pathname.includes("/rep/competitions") ||
                    location.pathname.includes("/rep/performance") ||
                    location.pathname.includes("/rep/commission") ||
                    location.pathname.includes("/rep/holiday") ||
                    location.pathname.includes("/rep/sickness") ||
                    location.pathname.includes("/rep/training") ||
                    location.pathname.includes("/rep/feedback") ||
                    location.pathname.includes("/rep/contract") ||
                    location.pathname.includes("/rep/policy");

  // Admin menu items - hide for reps, show for admins
  const adminLinks = ["admin-dashboard-link", "scheduler-link", "rep-tracker-link", "stats-link", "user-settings-link", "add-new-customer-link"];
  adminLinks.forEach(id => {
    const link = qs(id);
    if (link) link.classList.toggle("hidden", role !== "admin");
  });

  // Rep menu items - show for reps always, show for admins only on rep pages
  const repLinks = ["rep-log-link", "areas-map-link", "rep-chat-link", "competitions-link", 
                    "performance-link", "commission-link", "holiday-link", "sickness-link", 
                    "training-link", "feedback-link", "contract-link", "policy-link"];
  const showRepMenu = role === "rep" || (role === "admin" && isRepPage);
  repLinks.forEach(id => {
    const link = qs(id);
    if (link) link.classList.toggle("hidden", !showRepMenu);
  });

  // Dividers
  const divider1 = qs("rep-divider-1");
  const divider2 = qs("rep-divider-2");
  if (divider1) divider1.classList.toggle("hidden", !showRepMenu);
  if (divider2) divider2.classList.toggle("hidden", !showRepMenu);

  // Status indicator
  const statusIndicator = qs("statusIndicator");
  if (statusIndicator && navigator.onLine !== undefined) {
    statusIndicator.textContent = navigator.onLine ? "● Online" : "● Offline";
    statusIndicator.style.background = navigator.onLine ? "#10b981" : "#64748b";
  }

  // Subscriber menu visibility for shared pages (e.g., rep/scheduler.html)
  // Hide admin-only and admin-rep items for subscribers; show subscriber-only and admin-rep-subscriber
  try {
    const hideForSubscriber = document.querySelectorAll('.admin-only, .admin-rep');
    const showForSubscriber = document.querySelectorAll('.subscriber-only, .admin-rep-subscriber');
    if (role === 'subscriber') {
      hideForSubscriber.forEach(el => el.classList.add('hidden'));
      showForSubscriber.forEach(el => el.classList.remove('hidden'));
      // Rep-only items should also be hidden for subscribers on shared pages
      document.querySelectorAll('.rep-only').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.subscriber-sms-only').forEach(el => el.classList.remove('hidden'));
    } else {
      // When not a subscriber, do not force-hide these elements here
      // Let existing admin/rep logic above control visibility
      document.querySelectorAll('.subscriber-sms-only').forEach(el => el.classList.add('hidden'));
    }
  } catch (e) {
    console.warn('[Nav] Subscriber menu toggle failed', e);
  }
}

function initNav() {
  initMenuDropdown();
  initModalHandlers();
  initRepViewToggle();
  ensureRoleBadge();
  updateRoleBadge();

  const storedName = loadStoredSubscriberName();
  if (storedName) {
    setCompanyName(storedName);
  }
  
  // Update menu visibility based on role
  if (window.userRole) {
    updateMenuVisibility();
    updateRoleBadge();
  }
  
  // Re-check when user role is set (after auth loads)
  const checkInterval = setInterval(() => {
    if (window.userRole) {
      updateMenuVisibility();
      updateRoleBadge();
      clearInterval(checkInterval);
    }
  }, 100);
  
  // Update status indicator on network change
  window.addEventListener('online', updateMenuVisibility);
  window.addEventListener('offline', updateMenuVisibility);

  if (typeof window.onAuthStateChange === "function") {
    try {
      window.onAuthStateChange(() => {
        updateRoleBadge();
        updateMenuVisibility();
      });
    } catch (e) {
      console.warn('[Nav] Failed to subscribe to auth updates for role badge', e);
    }
  }

}

if (typeof window !== 'undefined') {
  window.addEventListener('swash:subscriber-profile', handleSubscriberProfileEvent);
}

document.addEventListener("DOMContentLoaded", initNav);

export { initNav, initMenuDropdown, initRepViewToggle, updateMenuVisibility, updateRoleBadge, ensureRoleBadge };
export default initNav;
