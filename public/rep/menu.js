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

export default initMenuDropdown;