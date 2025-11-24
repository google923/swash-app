import { auth, db } from './public/firebase-init.js';
import { ensureSubscriberAccess } from './lib/subscriber-access.js';
import { tenantCollection, tenantDoc } from './lib/subscriber-paths.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// State
const state = {
  currentUser: null,
  subscriberId: null,
  subscriberProfile: null,
  themeSettings: {}
};

// DOM Elements
const authOverlay = document.getElementById('authOverlay');
const mainContent = document.getElementById('mainContent');
const logoutBtn = document.getElementById('logoutBtn');

// Tab switching
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    const tabName = e.target.dataset.tab;
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelector(`[data-panel="${tabName}"]`).classList.add('active');
  });
});

// Theme color pickers
document.getElementById('bannerColor')?.addEventListener('change', (e) => {
  document.getElementById('bannerColorValue').textContent = e.target.value;
  document.getElementById('previewBanner').style.background = e.target.value;
});

document.getElementById('buttonColor')?.addEventListener('change', (e) => {
  document.getElementById('buttonColorValue').textContent = e.target.value;
  document.getElementById('previewButton').style.background = e.target.value;
});

document.getElementById('accentColor')?.addEventListener('change', (e) => {
  document.getElementById('accentColorValue').textContent = e.target.value;
});

document.getElementById('tabColor')?.addEventListener('change', (e) => {
  document.getElementById('tabColorValue').textContent = e.target.value;
});

// Logo upload preview
document.getElementById('companyLogoUpload')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('logoPreview').innerHTML = `<img src="${ev.target.result}" alt="Company logo preview" />`;
    };
    reader.readAsDataURL(file);
  }
});

// Save buttons
document.getElementById('saveQuoteFormBtn')?.addEventListener('click', saveQuoteFormSettings);
document.getElementById('saveEmailBtn')?.addEventListener('click', saveEmailSettings);
document.getElementById('saveSmsBtn')?.addEventListener('click', saveSmsSettings);
document.getElementById('saveCleanersBtn')?.addEventListener('click', saveCleanersSettings);
document.getElementById('saveRepsBtn')?.addEventListener('click', saveRepsSettings);
document.getElementById('saveThemeBtn')?.addEventListener('click', saveThemeSettings);

// Reset buttons
document.getElementById('resetQuoteFormBtn')?.addEventListener('click', () => {
  document.getElementById('quoteFormTitle').value = '';
  document.getElementById('quoteFormSubtitle').value = '';
  document.getElementById('quoteFormDescription').value = '';
});

document.getElementById('resetThemeBtn')?.addEventListener('click', () => {
  document.getElementById('bannerColor').value = '#0078d7';
  document.getElementById('buttonColor').value = '#0078d7';
  document.getElementById('accentColor').value = '#22c55e';
  document.getElementById('tabColor').value = '#0078d7';
  document.getElementById('bannerColorValue').textContent = '#0078d7';
  document.getElementById('buttonColorValue').textContent = '#0078d7';
  document.getElementById('accentColorValue').textContent = '#22c55e';
  document.getElementById('tabColorValue').textContent = '#0078d7';
  document.getElementById('previewBanner').style.background = '#0078d7';
  document.getElementById('previewButton').style.background = '#0078d7';
});

// Logout
logoutBtn?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = './subscriber-login.html';
  } catch (error) {
    console.error('Logout error:', error);
    alert('Failed to sign out');
  }
});

// Save settings functions
async function saveQuoteFormSettings() {
  try {
    if (!state.subscriberId) return;
    
    const settings = {
      quoteFormTitle: document.getElementById('quoteFormTitle').value || '',
      quoteFormSubtitle: document.getElementById('quoteFormSubtitle').value || '',
      quoteFormDescription: document.getElementById('quoteFormDescription').value || '',
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'quoteFormSettings');
    await setDoc(settingsRef, settings);
    showToast('✅ Quote form settings saved', 'success');
  } catch (error) {
    console.error('Save quote form settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

async function saveEmailSettings() {
  try {
    if (!state.subscriberId) return;
    
    const host = document.getElementById('smtpHost')?.value || '';
    const port = parseInt(document.getElementById('smtpPort')?.value || '0');
    const fromName = document.getElementById('emailFromName')?.value || '';
    const fromEmail = document.getElementById('emailAddress')?.value || '';
    const username = document.getElementById('emailUsername')?.value || '';
    const password = document.getElementById('emailPassword')?.value || '';
    const requireAuth = document.getElementById('requireAuth')?.checked || false;
    const useStartTls = document.getElementById('useStartTls')?.checked || false;

    const settings = {
      host,
      port,
      fromName,
      fromEmail,
      username: requireAuth ? username : '',
      requireAuth,
      useStartTls,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'emailSettings');
    await setDoc(settingsRef, settings, { merge: true });
    showToast('✅ Email settings saved', 'success');
  } catch (error) {
    console.error('Save email settings error:', error);
    showToast('❌ Failed to save email settings', 'error');
  }
}

async function saveSmsSettings() {
  try {
    if (!state.subscriberId) return;
    
    const provider = document.getElementById('smsProvider')?.value || 'twilio';
    const sender = document.getElementById('smsSender')?.value || '';
    const apiKey = document.getElementById('smsApiKey')?.value || '';
    
    // Base64 encode API key for basic security
    const encodedApiKey = apiKey ? btoa(apiKey) : '';

    const settings = {
      smsProvider: provider,
      smsSender: sender,
      smsApiKey: encodedApiKey,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'smsSettings');
    await setDoc(settingsRef, settings, { merge: true });
    showToast('✅ SMS settings saved', 'success');
    // Clear password field after save
    document.getElementById('smsApiKey').value = '';
  } catch (error) {
    console.error('Save SMS settings error:', error);
    showToast('❌ Failed to save SMS settings', 'error');
  }
}

async function saveCleanersSettings() {
  try {
    if (!state.subscriberId) return;
    
    const count = parseInt(document.getElementById('cleanerCount').value) || 10;
    const settings = {
      cleanerCount: count,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'cleanerSettings');
    await setDoc(settingsRef, settings);
    showToast('✅ Cleaner settings saved', 'success');
  } catch (error) {
    console.error('Save cleaner settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

async function saveRepsSettings() {
  try {
    if (!state.subscriberId) return;
    
    const count = parseInt(document.getElementById('repCount').value) || 10;
    const settings = {
      repCount: count,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'repSettings');
    await setDoc(settingsRef, settings);
    showToast('✅ Rep settings saved', 'success');
  } catch (error) {
    console.error('Save rep settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

async function saveThemeSettings() {
  try {
    if (!state.subscriberId) return;
    
    const settings = {
      bannerColor: document.getElementById('bannerColor').value || '#0078d7',
      buttonColor: document.getElementById('buttonColor').value || '#0078d7',
      accentColor: document.getElementById('accentColor').value || '#22c55e',
      tabColor: document.getElementById('tabColor').value || '#0078d7',
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'themeSettings');
    await setDoc(settingsRef, settings);
    
    // Apply theme immediately
    applyTheme(settings);
    showToast('✅ Theme settings saved and applied', 'success');
  } catch (error) {
    console.error('Save theme settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

function applyTheme(theme) {
  // Store in localStorage for persistence
  localStorage.setItem('swashTheme', JSON.stringify(theme));
  
  // Apply CSS variables
  document.documentElement.style.setProperty('--banner-color', theme.bannerColor);
  document.documentElement.style.setProperty('--button-color', theme.buttonColor);
  document.documentElement.style.setProperty('--accent-color', theme.accentColor);
  document.documentElement.style.setProperty('--tab-color', theme.tabColor);
}

async function loadSettings() {
  try {
    if (!state.subscriberId) return;

    // Load quote form settings
    const qfRef = tenantDoc(db, state.subscriberId, 'private', 'quoteFormSettings');
    const qfSnap = await getDoc(qfRef);
    if (qfSnap.exists()) {
      const data = qfSnap.data();
      document.getElementById('quoteFormTitle').value = data.quoteFormTitle || '';
      document.getElementById('quoteFormSubtitle').value = data.quoteFormSubtitle || '';
      document.getElementById('quoteFormDescription').value = data.quoteFormDescription || '';
    }

    // Load email settings
    const emailRef = tenantDoc(db, state.subscriberId, 'private', 'emailSettings');
    const emailSnap = await getDoc(emailRef);
    if (emailSnap.exists()) {
      const data = emailSnap.data();
      document.getElementById('smtpHost').value = data.host || '';
      document.getElementById('smtpPort').value = data.port || '';
      document.getElementById('emailFromName').value = data.fromName || '';
      document.getElementById('emailAddress').value = data.fromEmail || '';
      document.getElementById('emailUsername').value = data.username || '';
      document.getElementById('requireAuth').checked = data.requireAuth || false;
      document.getElementById('useStartTls').checked = data.useStartTls || false;
      // Note: password is never loaded for security
    }

    // Load SMS settings
    const smsRef = tenantDoc(db, state.subscriberId, 'private', 'smsSettings');
    const smsSnap = await getDoc(smsRef);
    if (smsSnap.exists()) {
      const data = smsSnap.data();
      document.getElementById('smsProvider').value = data.smsProvider || 'twilio';
      document.getElementById('smsSender').value = data.smsSender || '';
      if (data.smsApiKey) {
        try {
          document.getElementById('smsApiKey').value = atob(data.smsApiKey);
        } catch (e) {
          console.warn('Could not decode SMS API key');
          document.getElementById('smsApiKey').value = '';
        }
      }
    }

    // Load cleaner settings
    const cleanerRef = tenantDoc(db, state.subscriberId, 'private', 'cleanerSettings');
    const cleanerSnap = await getDoc(cleanerRef);
    if (cleanerSnap.exists()) {
      const data = cleanerSnap.data();
      document.getElementById('cleanerCount').value = data.cleanerCount || 10;
    }

    // Load rep settings
    const repRef = tenantDoc(db, state.subscriberId, 'private', 'repSettings');
    const repSnap = await getDoc(repRef);
    if (repSnap.exists()) {
      const data = repSnap.data();
      document.getElementById('repCount').value = data.repCount || 10;
    }

    // Load theme settings
    const themeRef = tenantDoc(db, state.subscriberId, 'private', 'themeSettings');
    const themeSnap = await getDoc(themeRef);
    if (themeSnap.exists()) {
      const data = themeSnap.data();
      state.themeSettings = data;
      document.getElementById('bannerColor').value = data.bannerColor || '#0078d7';
      document.getElementById('buttonColor').value = data.buttonColor || '#0078d7';
      document.getElementById('accentColor').value = data.accentColor || '#22c55e';
      document.getElementById('tabColor').value = data.tabColor || '#0078d7';
      
      document.getElementById('bannerColorValue').textContent = data.bannerColor || '#0078d7';
      document.getElementById('buttonColorValue').textContent = data.buttonColor || '#0078d7';
      document.getElementById('accentColorValue').textContent = data.accentColor || '#22c55e';
      document.getElementById('tabColorValue').textContent = data.tabColor || '#0078d7';
      
      document.getElementById('previewBanner').style.background = data.bannerColor || '#0078d7';
      document.getElementById('previewButton').style.background = data.buttonColor || '#0078d7';
      
      applyTheme(data);
    }
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-weight: 600;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Initialize
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = './subscriber-login.html';
    return;
  }

  try {
    state.currentUser = user;
    const access = await ensureSubscriberAccess(user);
    state.subscriberId = access.subscriberId;
    state.subscriberProfile = access.subscriberProfile;

    authOverlay.style.display = 'none';
    mainContent.style.display = 'block';

    await loadSettings();
  } catch (error) {
    console.error('Auth error:', error);
    authOverlay.innerHTML = `<div class="auth-card"><h2>Access Denied</h2><p>${error.message}</p></div>`;
  }
});
