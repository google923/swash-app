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

  // Hide/show common admin menu items when in rep view
  const adminLinkIds = ["admin-dashboard-link", "schedule-link", "manage-users-link"];
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

function initNav() {
  initMenuDropdown();
  initModalHandlers();
  initRepViewToggle();
}

document.addEventListener("DOMContentLoaded", initNav);

export { initNav, initMenuDropdown, initRepViewToggle };
export default initNav;
