// Global navigation, modal handlers, and admin-only Rep View toggle
// Requires auth-check.js to have set window.userRole

function qs(id) { return document.getElementById(id); }

function initMenuDropdown() {
  const menuBtn = qs("menuBtn");
  const menuDropdown = qs("menuDropdown");
  if (!menuBtn || !menuDropdown) return;
  if (menuBtn.dataset.menuInit) return;
  menuBtn.dataset.menuInit = "1";

  // Ensure closed by default
  menuDropdown.classList.remove("show");
  menuBtn.setAttribute("aria-expanded", "false");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const shown = menuDropdown.classList.toggle("show");
    menuBtn.setAttribute("aria-expanded", shown ? "true" : "false");
  });

  document.addEventListener("click", (e) => {
    if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
      menuDropdown.classList.remove("show");
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menuDropdown.classList.remove("show");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.blur();
    }
  });
  console.log("[Nav] Dropdown initialized");
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
      location.href = "/admin.html";
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
      const fallback = backBtn.getAttribute("data-fallback") || (window.userRole === "admin" ? "/admin.html" : "/rep/rep-home.html");
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
    } else {
      // When not a subscriber, do not force-hide these elements here
      // Let existing admin/rep logic above control visibility
    }
  } catch (e) {
    console.warn('[Nav] Subscriber menu toggle failed', e);
  }
}

function initNav() {
  initMenuDropdown();
  initModalHandlers();
  initRepViewToggle();
  
  // Update menu visibility based on role
  if (window.userRole) {
    updateMenuVisibility();
  }
  
  // Re-check when user role is set (after auth loads)
  const checkInterval = setInterval(() => {
    if (window.userRole) {
      updateMenuVisibility();
      clearInterval(checkInterval);
    }
  }, 100);
  
  // Update status indicator on network change
  window.addEventListener('online', updateMenuVisibility);
  window.addEventListener('offline', updateMenuVisibility);
}

document.addEventListener("DOMContentLoaded", initNav);

export { initNav, initMenuDropdown, initRepViewToggle, updateMenuVisibility };
export default initNav;
