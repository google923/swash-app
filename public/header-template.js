import { auth, db } from './firebase-init.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { initAIHelper, openAIHelper, setAIHelperContext } from './ai-helper.js';

/**
 * Initialize subscriber header - injects template and sets up event listeners
 */
export async function initSubscriberHeader() {
  // Inject header template if not already present
  if (!document.querySelector('header.header')) {
    try {
      const response = await fetch('./public/header.html');
      const headerHtml = await response.text();
      document.body.insertAdjacentHTML('afterbegin', headerHtml);
    } catch (error) {
      console.error('Failed to load header template:', error);
    }
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupHeaderListeners);
  } else {
    setupHeaderListeners();
  }
  
  // Apply custom theme for this subscriber
  await applySubscriberTheme();
  
  // Hide auth overlay if present (user is logged in)
  setTimeout(() => {
    const overlay = document.getElementById('authOverlay');
    if (overlay && overlay.style.display !== 'none') {
      overlay.style.display = 'none';
    }
  }, 100);
}

/**
 * Apply subscriber's custom theme settings
 * @param {string} subscriberId - The subscriber's ID (optional, falls back to localStorage)
 */
export async function applySubscriberTheme(subscriberId = null) {
  try {
    // Use provided subscriberId or fall back to localStorage
    const id = subscriberId || localStorage.getItem('swash:lastSubscriberId');
    if (!id) {
      console.warn('No subscriberId available for theme loading');
      return;
    }

    // Load theme settings from Firestore
    // Use private collection path as per security rules
    const themeRef = doc(db, 'subscribers', id, 'private', 'theme');
    const themeSnap = await getDoc(themeRef);
    
    if (!themeSnap.exists()) {
      // No theme found, use default
      return;
    }

    const theme = themeSnap.data();
    applyThemeToDOM(theme);
  } catch (error) {
    console.warn('Failed to load custom theme:', error);
  }
}

/**
 * Apply theme object to DOM elements
 */
function applyThemeToDOM(theme) {
  const header = document.querySelector('header.header');
  const tabRow = document.querySelector('div[style*="background:#0078d7"]');
  
  if (!header && !tabRow) return;

  // Apply banner color
  if (theme.bannerColor && header) {
    header.style.background = theme.bannerColor;
  }
  
  // Apply tab background color (darker shade)
  if (theme.tabColor && tabRow) {
    const tabs = tabRow.querySelectorAll('.header-tab');
    const tabBgColor = shadeColor(theme.tabColor, -20); // Make it slightly darker
    tabs.forEach(tab => {
      tab.style.background = tabBgColor;
    });
  }

  // Apply custom logo if exists (supports both Base64 data URLs and regular URLs)
  // Show logo in the company name pill next to the company name
  if (theme.logoDataUrl || theme.logoUrl) {
    const companyLogo = document.getElementById('companyLogo');
    if (companyLogo) {
      companyLogo.src = theme.logoDataUrl || theme.logoUrl;
      companyLogo.style.display = 'block';
      companyLogo.style.maxWidth = '80px';
      companyLogo.style.maxHeight = '28px';
      companyLogo.style.objectFit = 'contain';
    }
  }

  // Apply background image to body if exists (supports both Base64 data URLs and regular URLs)
  if (theme.backgroundDataUrl || theme.backgroundUrl) {
    const bgUrl = theme.backgroundDataUrl || theme.backgroundUrl;
    
    // Create a pseudo-element with opacity for the background image
    if (!document.getElementById('custom-bg-override')) {
      const style = document.createElement('style');
      style.id = 'custom-bg-override';
      style.innerHTML = `
        body::before { 
          display: none !important; 
        }
        body::after {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: url('${bgUrl}');
          background-attachment: fixed;
          background-size: cover;
          background-position: center;
          opacity: 0.75;
          z-index: -1;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    } else {
      const styleEl = document.getElementById('custom-bg-override');
      styleEl.innerHTML = `
        body::before { 
          display: none !important; 
        }
        body::after {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: url('${bgUrl}');
          background-attachment: fixed;
          background-size: cover;
          background-position: center;
          opacity: 0.75;
          z-index: -1;
          pointer-events: none;
        }
      `;
    }
  } else {
    // Reset to default if no custom background
    const styleEl = document.getElementById('custom-bg-override');
    if (styleEl) {
      styleEl.innerHTML = `body::before { display: block !important; }`;
    }
  }

  // Apply button colors globally via CSS
  if (theme.buttonColor) {
    applyButtonColors(theme.buttonColor);
  }

  // Store theme in window for access by other pages
  window._subscriberTheme = theme;
}

/**
 * Apply button colors globally
 */
function applyButtonColors(color) {
  if (!document.getElementById('subscriber-theme-styles')) {
    const style = document.createElement('style');
    style.id = 'subscriber-theme-styles';
    document.head.appendChild(style);
  }
  
  const style = document.getElementById('subscriber-theme-styles');
  style.textContent = `
    .btn-primary, .btn-save {
      background-color: ${color} !important;
    }
    .btn-primary:hover, .btn-save:hover {
      background-color: ${shadeColor(color, -15)} !important;
    }
  `;
}

/**
 * Lighten or darken a color
 */
function shadeColor(color, percent) {
  const num = parseInt(color.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, (num >> 8 & 0x00FF) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/**
 * Setup event listeners on existing header elements
 */
function setupHeaderListeners() {
  // AI Helper button
  const aiHelperBtn = document.getElementById('aiHelperBtn');
  if (aiHelperBtn) {
    aiHelperBtn.addEventListener('click', openAIHelper);
  }

  // Initialize AI Helper modal
  initAIHelper();

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        window.location.href = './subscriber-login.html';
      } catch (error) {
        console.error('Logout error:', error);
        alert('Failed to sign out');
      }
    });
  }
  
  // Tab navigation
  document.querySelectorAll('.header-tab').forEach(tab => {
    tab.addEventListener('click', handleTabClick);
  });
  
  // Set active tab styling based on current page
  setActiveTabByCurrent();
}

/**
 * Determine current page and set active tab styling
 */
function setActiveTabByCurrent() {
  const currentPath = window.location.pathname;
  let activeTab = 'quotes'; // default
  
  if (currentPath.includes('schedule')) {
    activeTab = 'schedule';
  } else if (currentPath.includes('tracking')) {
    activeTab = 'tracking';
  } else if (currentPath.includes('rep-log')) {
    activeTab = 'rep-log';
  } else if (currentPath.includes('settings')) {
    activeTab = 'settings';
  }
  
  setActiveTab(activeTab);
}

/**
 * Handle tab clicks - navigate to corresponding page
 */
function handleTabClick(e) {
  const tabName = e.target.dataset.tab;
  const tabMap = {
    'quotes': '/subscriber-add-new-customer.html',
    'schedule': '/subscriber-schedule-full.html',
    'tracking': '/subscriber-tracking.html',
    'rep-log': '/subscriber-rep-log.html',
    'settings': '/subscriber-settings.html'
  };
  
  const url = tabMap[tabName];
  if (url) {
    window.location.href = url;
  }
}

/**
 * Set the company name in the header
 * This assumes header element exists in HTML with a company name display area
 * If no display area exists, this function safely does nothing
 */
export function setCompanyName(name) {
  // Try to find company name display if it exists
  const display = document.getElementById('companyNameDisplay');
  if (display) {
    display.textContent = name || '';
  }
}

/**
 * Set AI Helper context with subscriber info
 * Call this from pages after auth is ready
 */
export function initializeAIHelper(subscriberId, subscriberName, cleaners = []) {
  setAIHelperContext(subscriberId, subscriberName, cleaners);
}

/**
 * Set active tab styling based on page
 * Updates the active class on the appropriate tab button
 */
export function setActiveTab(tabName) {
  document.querySelectorAll('.header-tab').forEach(tab => {
    const isActive = tab.dataset.tab === tabName;
    if (isActive) {
      // Active tab: lighter blue background
      tab.style.background = '#0066b3';
      tab.style.color = '#fff';
    } else {
      // Inactive tab: same as banner
      tab.style.background = '#0078d7';
      tab.style.color = '#fff';
    }
  });
}
