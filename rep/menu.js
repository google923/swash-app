// Shared menu dropdown initializer for Swash PWA pages.
// Ensures the header menu toggles correctly and closes on outside/escape.

export function initMenuDropdown() {
  const menuBtn = document.getElementById("menuBtn");
  const menuDropdown = document.getElementById("menuDropdown");
  if (!menuBtn || !menuDropdown) return;
  if (menuBtn.dataset.menuInit) return;
  menuBtn.dataset.menuInit = "1";

  function hideMenu() {
    menuDropdown.classList.remove("show");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const shown = menuDropdown.classList.toggle("show");
    menuBtn.setAttribute("aria-expanded", shown ? "true" : "false");
  });

  document.addEventListener("click", (event) => {
    if (!menuBtn.contains(event.target) && !menuDropdown.contains(event.target)) {
      hideMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMenu();
      menuBtn.blur();
    }
  });

  menuDropdown.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      hideMenu();
    }
  });
}

// Role-based menu logic
export function setMenuForRole(role) {
  // role: 'rep', 'admin', 'cleaner', or undefined
  // Hide all role-specific links by default
  const repHome = document.getElementById('rep-home-link');
  const adminDashboard = document.getElementById('admin-dashboard-link');
  const cleanerDashboard = document.getElementById('cleaner-dashboard-link');
  const adminTracking = document.getElementById('admin-tracking-link');
  const addCustomer = document.getElementById('add-customer-link');
  const schedule = document.getElementById('schedule-link');
  const manageUsers = document.getElementById('manage-users-link');
  const stats = document.getElementById('stats-link');
  const messageLog = document.getElementById('message-log-link');
  
  // Hide all by default
  if (repHome) repHome.classList.add('hidden');
  if (adminDashboard) adminDashboard.classList.add('hidden');
  if (cleanerDashboard) cleanerDashboard.classList.add('hidden');
  if (adminTracking) adminTracking.classList.add('hidden');
  if (addCustomer) addCustomer.classList.add('hidden');
  if (schedule) schedule.classList.add('hidden');
  if (manageUsers) manageUsers.classList.add('hidden');
  if (stats) stats.classList.add('hidden');
  if (messageLog) messageLog.classList.add('hidden');

  if (role === 'rep') {
    // Reps only see their home dashboard
    if (repHome) repHome.classList.remove('hidden');
  } else if (role === 'admin') {
    // Admins see everything
    if (repHome) repHome.classList.remove('hidden');
    if (adminDashboard) adminDashboard.classList.remove('hidden');
    if (cleanerDashboard) cleanerDashboard.classList.remove('hidden');
    if (adminTracking) adminTracking.classList.remove('hidden');
    if (addCustomer) addCustomer.classList.remove('hidden');
    if (schedule) schedule.classList.remove('hidden');
    if (manageUsers) manageUsers.classList.remove('hidden');
    if (stats) stats.classList.remove('hidden');
    if (messageLog) messageLog.classList.remove('hidden');
  } else if (role === 'cleaner') {
    // Cleaners see cleaner dashboard
    if (cleanerDashboard) cleanerDashboard.classList.remove('hidden');
  }
}

export default initMenuDropdown;