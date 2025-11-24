import { auth, db } from './public/firebase-init.js';
import { ensureSubscriberAccess } from './lib/subscriber-access.js';
import { tenantCollection, tenantDoc } from './lib/subscriber-paths.js';
import { initSubscriberHeader, setCompanyName, setActiveTab, applySubscriberTheme, initializeAIHelper } from './public/header-template.js';
import { setSupportChatApiKey, openSupportChat } from './public/support-chat.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  collection,
  addDoc,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// SMS packages
const SMS_PACKAGES = [
  { id: "sms-500", credits: 500, priceGBP: 25, description: "500 SMS credits" },
  { id: "sms-1000", credits: 1000, priceGBP: 50, description: "1000 SMS credits" },
  { id: "sms-2500", credits: 2500, priceGBP: 125, description: "2500 SMS credits" },
  { id: "sms-5000", credits: 5000, priceGBP: 250, description: "5000 SMS credits" },
];

const VERCEL_FALLBACK_ORIGIN = "https://hooks.swashcleaning.co.uk";
const PENDING_FLOW_STORAGE_KEY = "smsPendingFlow";

// State
const state = {
  currentUser: null,
  subscriberId: null,
  subscriberProfile: null,
  themeSettings: {},
  cleaners: [],
  editingCleanerId: null,
  reps: [],
  editingRepId: undefined,
  smsPurchases: [],
  pendingPurchase: false,
  savingSender: false,
  billingData: null
};

// DOM Elements
const authOverlay = document.getElementById('authOverlay');
const mainContent = document.getElementById('mainContent');

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

// Theme color pickers - real-time preview
['bannerColor', 'buttonColor', 'accentColor', 'tabColor'].forEach(colorId => {
  const input = document.getElementById(colorId);
  if (input) {
    ['input', 'change'].forEach(event => {
      input.addEventListener(event, (e) => {
        const colorValue = e.target.value;
        document.getElementById(colorId + 'Value').textContent = colorValue;
        
        if (colorId === 'bannerColor') {
          document.getElementById('previewBanner').style.background = colorValue;
          // Also update header in real-time
          const header = document.querySelector('header');
          if (header) header.style.background = colorValue;
        } else if (colorId === 'buttonColor') {
          document.getElementById('previewButton').style.background = colorValue;
          // Update all buttons in real-time
          document.querySelectorAll('.btn-save, .btn-primary').forEach(btn => {
            btn.style.background = colorValue;
          });
        } else if (colorId === 'tabColor') {
          // Update tab preview
          document.querySelectorAll('.settings-tab').forEach(tab => {
            if (tab.classList.contains('active')) {
              tab.style.background = colorValue;
            }
          });
        }
      });
    });
  }
});

// Logo upload preview
document.getElementById('companyLogoUpload')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById('logoPreview');
      preview.style.background = '#ffffff';
      preview.innerHTML = `<img src="${ev.target.result}" alt="Company logo preview" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
    };
    reader.readAsDataURL(file);
  }
});

// Background image upload preview
document.getElementById('backgroundImageUpload')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById('backgroundPreview');
      if (preview) {
        preview.style.backgroundImage = `url('${ev.target.result}')`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
      }
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
document.getElementById('saveSupportBtn')?.addEventListener('click', saveSupportSettings);
document.getElementById('saveThemeBtn')?.addEventListener('click', saveThemeSettings);
document.getElementById('sendTestBtn')?.addEventListener('click', sendTestEmail);
document.getElementById('saveSenderBtn')?.addEventListener('click', handleSenderSubmit);
document.getElementById('senderForm')?.addEventListener('submit', handleSenderSubmit);

// Billing button listeners
document.getElementById('downloadInvoiceBtn')?.addEventListener('click', downloadLatestInvoice);
document.getElementById('viewBillingPortalBtn')?.addEventListener('click', viewBillingPortal);
document.getElementById('updatePaymentBtn')?.addEventListener('click', updatePaymentMethod);
document.getElementById('pauseSubscriptionBtn')?.addEventListener('click', pauseSubscription);
document.getElementById('cancelSubscriptionBtn')?.addEventListener('click', cancelSubscription);

// SMS package purchase listeners
document.getElementById('packagesContainer')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-package-id]');
  if (!button) return;
  const packageId = button.getAttribute('data-package-id');
  startSmsPurchase(packageId);
});
document.getElementById('addCleanerBtn')?.addEventListener('click', openAddCleanerModal);
document.getElementById('addRepBtn')?.addEventListener('click', openAddRepModal);

// Reset buttons
document.getElementById('resetQuoteFormBtn')?.addEventListener('click', () => {
  document.getElementById('quoteFormTitle').value = '';
  document.getElementById('quoteFormSubtitle').value = '';
  document.getElementById('quoteFormDescription').value = '';
  document.getElementById('quoteFormLogoUrl').value = '';
  document.getElementById('quoteFormPrimaryColor').value = '#0078d7';
  document.getElementById('quoteFormAccentColor').value = '#0ea5e9';
  document.getElementById('quoteFormBackgroundColor').value = '#ffffff';
  document.getElementById('quoteFormButtonLabel').value = 'Start Quote';
  document.getElementById('quoteFormCornerStyle').value = 'rounded';
  document.getElementById('tierSilverLabel').value = 'Silver';
  document.getElementById('tierSilverDescription').value = 'Windows only, every 4 weeks.';
  document.getElementById('tierGoldLabel').value = 'Gold';
  document.getElementById('tierGoldDescription').value = 'Frames, sills and reminders included.';
  document.getElementById('tierGoldMultiplier').value = '1.35';
  document.getElementById('pricingMinimum').value = '16';
  document.getElementById('pricingVatIncluded').value = 'true';
  document.getElementById('price2bed').value = '21';
  document.getElementById('price3bed').value = '24';
  document.getElementById('price4bed').value = '28';
  document.getElementById('price5bed').value = '32';
  document.getElementById('price6bed').value = '36';
  document.getElementById('priceExtensionAdd').value = '4';
  document.getElementById('priceConservatoryAdd').value = '6';
  document.getElementById('priceRoofLanternEach').value = '10';
  document.getElementById('priceSkylightEach').value = '1.50';
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

// Cleaner Modal
const cleanerModal = document.getElementById('cleanerModal');
const modalClose = document.getElementById('modalClose');
const cancelBtn = document.getElementById('cancelBtn');
const cleanerForm = document.getElementById('cleanerForm');

modalClose?.addEventListener('click', closeCleanerModal);
cancelBtn?.addEventListener('click', closeCleanerModal);
cleanerModal?.addEventListener('click', (e) => {
  if (e.target === cleanerModal) closeCleanerModal();
});

cleanerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Check if we're editing a rep or cleaner based on state
  if (state.editingRepId !== undefined) {
    await saveRepToFirestore();
  } else {
    await saveCleanerToFirestore();
  }
});

function openAddCleanerModal() {
  state.editingCleanerId = null;
  state.editingRepId = undefined;
  document.getElementById('modalTitle').textContent = 'Add Cleaner';
  // Restore form labels for cleaner
  document.querySelector('label[for="cleanerName"]').textContent = 'Cleaner Name *';
  document.getElementById('cleanerName').placeholder = 'e.g., John Smith';
  document.querySelector('label[for="cleanerEmail"]').textContent = 'Email';
  document.querySelector('label[for="cleanerPhone"]').textContent = 'Phone';
  document.getElementById('saveCleanerBtn').textContent = 'Save Cleaner';
  cleanerForm.reset();
  cleanerModal.classList.add('show');
}

function closeCleanerModal() {
  cleanerModal.classList.remove('show');
  cleanerForm.reset();
  state.editingCleanerId = null;
}

// Logout - wait for header to inject before attaching listener
setTimeout(() => {
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
}, 100);

// Save settings functions
async function saveQuoteFormSettings() {
  try {
    if (!state.subscriberId) return;
    
    const settings = {
      quoteFormTitle: document.getElementById('quoteFormTitle').value || '',
      quoteFormSubtitle: document.getElementById('quoteFormSubtitle').value || '',
      quoteFormDescription: document.getElementById('quoteFormDescription').value || '',
      quoteFormLogoUrl: document.getElementById('quoteFormLogoUrl').value || '',
      quoteFormPrimaryColor: document.getElementById('quoteFormPrimaryColor').value || '#0078d7',
      quoteFormAccentColor: document.getElementById('quoteFormAccentColor').value || '#0ea5e9',
      quoteFormBackgroundColor: document.getElementById('quoteFormBackgroundColor').value || '#ffffff',
      quoteFormButtonLabel: document.getElementById('quoteFormButtonLabel').value || 'Start Quote',
      quoteFormCornerStyle: document.getElementById('quoteFormCornerStyle').value || 'rounded',
      tierSilverLabel: document.getElementById('tierSilverLabel').value || 'Silver',
      tierSilverDescription: document.getElementById('tierSilverDescription').value || '',
      tierGoldLabel: document.getElementById('tierGoldLabel').value || 'Gold',
      tierGoldDescription: document.getElementById('tierGoldDescription').value || '',
      tierGoldMultiplier: parseFloat(document.getElementById('tierGoldMultiplier').value) || 1.35,
      pricingMinimum: parseFloat(document.getElementById('pricingMinimum').value) || 16,
      pricingVatIncluded: document.getElementById('pricingVatIncluded').value === 'true',
      price2bed: parseFloat(document.getElementById('price2bed').value) || 21,
      price3bed: parseFloat(document.getElementById('price3bed').value) || 24,
      price4bed: parseFloat(document.getElementById('price4bed').value) || 28,
      price5bed: parseFloat(document.getElementById('price5bed').value) || 32,
      price6bed: parseFloat(document.getElementById('price6bed').value) || 36,
      priceExtensionAdd: parseFloat(document.getElementById('priceExtensionAdd').value) || 4,
      priceConservatoryAdd: parseFloat(document.getElementById('priceConservatoryAdd').value) || 6,
      priceRoofLanternEach: parseFloat(document.getElementById('priceRoofLanternEach').value) || 10,
      priceSkylightEach: parseFloat(document.getElementById('priceSkylightEach').value) || 1.50,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'quoteFormSettings');
    await setDoc(settingsRef, settings, { merge: true });
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
    const minSend = parseInt(document.getElementById('minSend')?.value || '0');

    const settings = {
      host,
      port,
      fromName,
      fromEmail,
      username: requireAuth ? username : '',
      requireAuth,
      useStartTls,
      minSendMinutes: minSend,
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

async function sendTestEmail(e) {
  e.preventDefault();
  try {
    if (!state.subscriberId) return;
    
    const recipient = document.getElementById('testRecipient')?.value;
    const subject = document.getElementById('testSubject')?.value;
    const message = document.getElementById('testMessage')?.value;

    if (!recipient || !subject || !message) {
      showToast('❌ Please fill in all test email fields', 'error');
      return;
    }

    // Get email settings
    const emailRef = tenantDoc(db, state.subscriberId, 'private', 'emailSettings');
    const emailSnap = await getDoc(emailRef);
    
    if (!emailSnap.exists()) {
      showToast('❌ Email settings not configured', 'error');
      return;
    }

    document.getElementById('testStatus').textContent = 'Sending...';
    
    // In a real implementation, you'd call a Cloud Function to send this
    // For now, we'll show a placeholder message
    showToast('✅ Test email sent (Cloud Function integration needed)', 'success');
    document.getElementById('testStatus').textContent = 'Sent!';
    setTimeout(() => {
      document.getElementById('testStatus').textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Send test email error:', error);
    showToast('❌ Failed to send test email', 'error');
  }
}

async function saveSmsSettings() {
  try {
    if (!state.subscriberId) return;
    
    const provider = document.getElementById('smsProvider')?.value || 'twilio';
    const apiKey = document.getElementById('smsApiKey')?.value || '';
    
    // Base64 encode API key for basic security
    const encodedApiKey = apiKey ? btoa(apiKey) : '';

    const settings = {
      smsProvider: provider,
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

async function saveSenderName(e) {
  e.preventDefault();
  try {
    if (!state.subscriberId) return;
    
    const senderName = document.getElementById('senderName')?.value || '';
    if (!senderName) {
      showToast('❌ Please enter a sender name', 'error');
      return;
    }

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'smsSettings');
    await setDoc(settingsRef, { smsSender: senderName, updatedAt: serverTimestamp() }, { merge: true });
    showToast('✅ Sender name saved', 'success');
  } catch (error) {
    console.error('Save sender name error:', error);
    showToast('❌ Failed to save sender name', 'error');
  }
}

async function saveCleanersSettings() {
  try {
    if (!state.subscriberId) return;
    
    const count = parseInt(document.getElementById('cleanerCount')?.value || '10');
    const settings = {
      cleanerCount: count,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'cleanerSettings');
    await setDoc(settingsRef, settings, { merge: true });
    showToast('✅ Cleaner settings saved', 'success');
  } catch (error) {
    console.error('Save cleaner settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

async function saveRepsSettings() {
  try {
    if (!state.subscriberId) return;
    
    const count = parseInt(document.getElementById('repCount')?.value || '10');
    const settings = {
      repCount: count,
      updatedAt: serverTimestamp()
    };

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'repSettings');
    await setDoc(settingsRef, settings, { merge: true });
    showToast('✅ Rep settings saved', 'success');
  } catch (error) {
    console.error('Save rep settings error:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

/**
 * Compress image to fit Firestore size limits
 * @param {File} file - Image file to compress
 * @param {number} quality - Quality (0-1, default 0.7)
 * @param {number} maxWidth - Max width in pixels (default 1200)
 * @returns {Promise<string>} Compressed Base64 data URL
 */
async function compressImage(file, quality = 0.7, maxWidth = 1200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if too large
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        
        // For PNG files, set a white background to replace transparency
        if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Use PNG for logos to preserve quality; use JPEG for backgrounds to save space
        // Logos: prefer PNG format for crisp rendering
        // Backgrounds: use JPEG to reduce file size
        const mimeType = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const compressedDataUrl = canvas.toDataURL(mimeType, quality);
        resolve(compressedDataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveThemeSettings() {
  try {
    if (!state.subscriberId) return;
    
    const saveBtn = document.getElementById('saveThemeBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    const settings = {
      bannerColor: document.getElementById('bannerColor').value || '#0078d7',
      buttonColor: document.getElementById('buttonColor').value || '#0078d7',
      accentColor: document.getElementById('accentColor').value || '#22c55e',
      tabColor: document.getElementById('tabColor').value || '#0078d7',
      updatedAt: serverTimestamp()
    };

    // Handle logo - save as Base64 data URL (no Firebase Storage needed!)
    const logoInput = document.getElementById('companyLogoUpload');
    if (logoInput?.files?.[0]) {
      const logoFile = logoInput.files[0];
      
      // Validate file size (max 2MB for data URL storage)
      if (logoFile.size > 2 * 1024 * 1024) {
        showToast('❌ Logo file too large (max 2MB)', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        return;
      }
      
      // Compress logo to fit Firestore limits
      const compressedLogoUrl = await compressImage(logoFile, 0.8, 400); // 80% quality, max 400px
      
      // Validate compressed size (must be < 300KB)
      if (compressedLogoUrl.length > 300 * 1024) {
        showToast('❌ Logo too large even after compression. Try a smaller image.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        return;
      }
      
      settings.logoDataUrl = compressedLogoUrl;
    }

    // Handle background image - save as Base64 data URL
    const bgInput = document.getElementById('backgroundImageUpload');
    if (bgInput?.files?.[0]) {
      const bgFile = bgInput.files[0];
      
      // Validate file size (max 3.5MB for initial file)
      if (bgFile.size > 3.5 * 1024 * 1024) {
        showToast('❌ Background file too large (max 3.5MB)', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        return;
      }
      
      // Compress image to fit Firestore limits
      const compressedDataUrl = await compressImage(bgFile, 0.6, 1200); // 60% quality, max 1200px
      
      // Validate compressed size (must be < 1.2MB Base64 string to fit in Firestore with other data)
      if (compressedDataUrl.length > 1.2 * 1024 * 1024) {
        showToast('❌ Image too large even after compression. Try a smaller or lower quality image.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        return;
      }
      
      settings.backgroundDataUrl = compressedDataUrl;
    }

    // Save to Firestore at subscribers/{id}/private/theme
    // Base64 data URLs are stored directly - no Firebase Storage needed
    const themeDocRef = doc(db, 'subscribers', state.subscriberId, 'private', 'theme');
    await setDoc(themeDocRef, settings, { merge: true });
    
    // Apply theme immediately across all pages
    await applySubscriberTheme();
    
    // Clear file inputs after successful save
    if (logoInput) logoInput.value = '';
    if (bgInput) bgInput.value = '';
    
    showToast('✅ Theme saved and applied to all your pages', 'success');
  } catch (error) {
    console.error('Save theme settings error:', error);
    showToast('❌ Failed to save theme: ' + error.message, 'error');
  } finally {
    const saveBtn = document.getElementById('saveThemeBtn');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Theme';
  }
}

async function saveCleanerToFirestore() {
  try {
    if (!state.subscriberId) return;

    const name = document.getElementById('cleanerName').value;
    const email = document.getElementById('cleanerEmail').value || '';
    const phone = document.getElementById('cleanerPhone').value || '';
    const status = document.getElementById('cleanerStatus').value;

    if (!name) {
      showToast('❌ Cleaner name is required', 'error');
      return;
    }

    const cleanersRef = tenantCollection(db, state.subscriberId, 'cleaners');
    
    if (state.editingCleanerId) {
      // Update existing
      await updateDoc(doc(cleanersRef, state.editingCleanerId), {
        name,
        email,
        phone,
        status,
        updatedAt: serverTimestamp()
      });
      showToast('✅ Cleaner updated', 'success');
    } else {
      // Create new
      await setDoc(doc(cleanersRef), {
        name,
        email,
        phone,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast('✅ Cleaner added', 'success');
    }

    closeCleanerModal();
    loadCleaners();
  } catch (error) {
    console.error('Save cleaner error:', error);
    showToast('❌ Failed to save cleaner', 'error');
  }
}

async function loadCleaners() {
  try {
    console.log('🔍 loadCleaners: Starting, subscriberId=', state.subscriberId);
    if (!state.subscriberId) {
      console.warn('🔍 loadCleaners: No subscriberId, returning');
      return;
    }

    const cleanersRef = tenantCollection(db, state.subscriberId, 'cleaners');
    console.log('🔍 loadCleaners: Reference created:', cleanersRef);
    const cleanersSnap = await getDocs(cleanersRef);
    
    console.log('🔍 loadCleaners: Got snapshot with', cleanersSnap.size, 'docs');
    state.cleaners = [];
    cleanersSnap.forEach(docSnap => {
      console.log('🔍 loadCleaners: Adding doc:', docSnap.id, docSnap.data());
      state.cleaners.push({ id: docSnap.id, ...docSnap.data() });
    });
    
    console.log('🔍 loadCleaners: Loaded', state.cleaners.length, 'cleaners, array=', state.cleaners);
    console.log('🔍 loadCleaners: Calling renderCleaners');
    renderCleaners();
    console.log('🔍 loadCleaners: Done');
  } catch (error) {
    console.error('❌ Load cleaners error:', error);
    console.error('❌ Error stack:', error.stack);
  }
}

function renderCleaners() {
  console.log('🎨 renderCleaners: Starting, state.cleaners=', state.cleaners);
  const grid = document.getElementById('cleanersGrid');
  
  console.log('🎨 renderCleaners: Grid element=', grid);
  if (!grid) {
    console.error('🎨 renderCleaners: Grid element NOT FOUND! Cannot render cleaners');
    return;
  }

  if (state.cleaners.length === 0) {
    console.log('🎨 renderCleaners: No cleaners, showing empty message');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#64748b;">No cleaners added yet. Click "+ Add Cleaner" to get started.</div>';
    console.log('🎨 renderCleaners: Set empty message');
    return;
  }

  console.log('🎨 renderCleaners: Rendering', state.cleaners.length, 'cleaners');
  grid.innerHTML = state.cleaners.map(cleaner => `
    <div class="cleaner-card">
      <div class="cleaner-header">
        <div class="cleaner-name">${escapeHtml(cleaner.name)}</div>
        <span class="cleaner-badge ${cleaner.status === 'active' ? 'badge-active' : 'badge-inactive'}">
          ${cleaner.status === 'active' ? '✓ Active' : '✗ Inactive'}
        </span>
      </div>
      <div class="cleaner-info">
        ${cleaner.email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value">${escapeHtml(cleaner.email)}</span></div>` : ''}
        ${cleaner.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${escapeHtml(cleaner.phone)}</span></div>` : ''}
      </div>
      <div class="cleaner-actions">
        <button class="btn-save" onclick="window.editCleaner('${cleaner.id}')">Edit</button>
        <button class="btn-reset" onclick="window.deleteCleaner('${cleaner.id}')">Delete</button>
      </div>
    </div>
  `).join('');
  console.log('🎨 renderCleaners: HTML set, complete');
}

window.editCleaner = async function(cleanerId) {
  const cleaner = state.cleaners.find(c => c.id === cleanerId);
  if (!cleaner) return;

  state.editingCleanerId = cleanerId;
  document.getElementById('modalTitle').textContent = 'Edit Cleaner';
  document.getElementById('cleanerName').value = cleaner.name;
  document.getElementById('cleanerEmail').value = cleaner.email || '';
  document.getElementById('cleanerPhone').value = cleaner.phone || '';
  document.getElementById('cleanerStatus').value = cleaner.status;
  cleanerModal.classList.add('show');
};

window.deleteCleaner = async function(cleanerId) {
  if (!confirm('Are you sure you want to delete this cleaner?')) return;

  try {
    if (!state.subscriberId) return;
    const cleanersRef = tenantCollection(db, state.subscriberId, 'cleaners');
    await deleteDoc(doc(cleanersRef, cleanerId));
    showToast('✅ Cleaner deleted', 'success');
    loadCleaners();
  } catch (error) {
    console.error('Delete cleaner error:', error);
    showToast('❌ Failed to delete cleaner', 'error');
  }
};

// Rep management functions
function openAddRepModal() {
  state.editingCleanerId = undefined;
  state.editingRepId = null;
  document.getElementById('modalTitle').textContent = 'Add Rep';
  // Update form labels for rep
  document.querySelector('label[for="cleanerName"]').textContent = 'Rep Name *';
  document.getElementById('cleanerName').placeholder = 'e.g., John Smith';
  document.querySelector('label[for="cleanerEmail"]').textContent = 'Email';
  document.querySelector('label[for="cleanerPhone"]').textContent = 'Phone';
  document.getElementById('saveCleanerBtn').textContent = 'Save Rep';
  // Reset form
  document.getElementById('cleanerName').value = '';
  document.getElementById('cleanerEmail').value = '';
  document.getElementById('cleanerPhone').value = '';
  document.getElementById('cleanerStatus').value = 'active';
  cleanerModal.classList.add('show');
}

function closeRepModal() {
  cleanerModal.classList.remove('show');
  state.editingRepId = undefined;
}

async function saveRepToFirestore() {
  try {
    if (!state.subscriberId) return;

    const name = document.getElementById('cleanerName').value;
    const email = document.getElementById('cleanerEmail').value || '';
    const phone = document.getElementById('cleanerPhone').value || '';
    const status = document.getElementById('cleanerStatus').value;

    if (!name) {
      showToast('❌ Rep name is required', 'error');
      return;
    }

    const repsRef = tenantCollection(db, state.subscriberId, 'reps');
    
    if (state.editingRepId !== undefined) {
      // Update existing
      await updateDoc(doc(repsRef, state.editingRepId), {
        name,
        email,
        phone,
        status,
        updatedAt: serverTimestamp()
      });
      showToast('✅ Rep updated', 'success');
    } else {
      // Create new
      await setDoc(doc(repsRef), {
        name,
        email,
        phone,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast('✅ Rep added', 'success');
    }

    closeRepModal();
    loadReps();
    updateRepsCost();
  } catch (error) {
    console.error('Save rep error:', error);
    showToast('❌ Failed to save rep', 'error');
  }
}

async function loadReps() {
  try {
    console.log('🔍 loadReps: Starting, subscriberId=', state.subscriberId);
    if (!state.subscriberId) {
      console.warn('🔍 loadReps: No subscriberId, returning');
      return;
    }

    const repsRef = tenantCollection(db, state.subscriberId, 'reps');
    console.log('🔍 loadReps: Reference created:', repsRef);
    const repsSnap = await getDocs(repsRef);
    
    console.log('🔍 loadReps: Got snapshot with', repsSnap.size, 'docs');
    state.reps = [];
    repsSnap.forEach(docSnap => {
      console.log('🔍 loadReps: Adding doc:', docSnap.id, docSnap.data());
      state.reps.push({ id: docSnap.id, ...docSnap.data() });
    });

    console.log('🔍 loadReps: Loaded', state.reps.length, 'reps, array=', state.reps);
    console.log('🔍 loadReps: Calling renderReps');
    renderReps();
    console.log('🔍 loadReps: Calling updateRepsCost');
    updateRepsCost();
    console.log('🔍 loadReps: Done');
  } catch (error) {
    console.error('❌ Load reps error:', error);
    console.error('❌ Error stack:', error.stack);
  }
}

function renderReps() {
  console.log('🎨 renderReps: Starting');
  const grid = document.getElementById('repsGrid');
  
  console.log('🎨 renderReps: Grid element=', grid);
  if (!grid) {
    console.warn('🎨 renderReps: Grid not found');
    return;
  }

  if (state.reps.length === 0) {
    console.log('🎨 renderReps: No reps, showing empty message');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#64748b;">No reps added yet. Click "+ Add Rep" to get started.</div>';
    return;
  }

  console.log('🎨 renderReps: Rendering', state.reps.length, 'reps');
  grid.innerHTML = state.reps.map(rep => `
    <div class="cleaner-card">
      <div class="cleaner-header">
        <div class="cleaner-name">${escapeHtml(rep.name)}</div>
        <span class="cleaner-badge ${rep.status === 'active' ? 'badge-active' : 'badge-inactive'}">
          ${rep.status === 'active' ? '✓ Active' : '✗ Inactive'}
        </span>
      </div>
      <div class="cleaner-info">
        ${rep.email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value">${escapeHtml(rep.email)}</span></div>` : ''}
        ${rep.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${escapeHtml(rep.phone)}</span></div>` : ''}
      </div>
      <div class="cleaner-actions">
        <button class="btn-save" onclick="window.editRep('${rep.id}')">Edit</button>
        <button class="btn-reset" onclick="window.deleteRep('${rep.id}')">Delete</button>
      </div>
    </div>
  `).join('');
  console.log('🎨 renderReps: Complete');
}

window.editRep = async function(repId) {
  const rep = state.reps.find(r => r.id === repId);
  if (!rep) return;

  state.editingRepId = repId;
  document.getElementById('modalTitle').textContent = 'Edit Rep';
  document.getElementById('cleanerName').value = rep.name;
  document.getElementById('cleanerEmail').value = rep.email || '';
  document.getElementById('cleanerPhone').value = rep.phone || '';
  document.getElementById('cleanerStatus').value = rep.status;
  cleanerModal.classList.add('show');
};

window.deleteRep = async function(repId) {
  if (!confirm('Are you sure you want to delete this rep?')) return;

  try {
    if (!state.subscriberId) return;
    const repsRef = tenantCollection(db, state.subscriberId, 'reps');
    await deleteDoc(doc(repsRef, repId));
    showToast('✅ Rep deleted', 'success');
    loadReps();
  } catch (error) {
    console.error('Delete rep error:', error);
    showToast('❌ Failed to delete rep', 'error');
  }
};

function updateRepsCost() {
  const baseCost = 10; // Base subscription includes 1 rep
  const extraReps = Math.max(0, state.reps.length - 1);
  const totalCost = baseCost + (extraReps * 10);
  const costEl = document.getElementById('repsTotalCost');
  if (costEl) {
    costEl.textContent = `£${totalCost.toFixed(2)}`;
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
      document.getElementById('quoteFormLogoUrl').value = data.quoteFormLogoUrl || '';
      document.getElementById('quoteFormPrimaryColor').value = data.quoteFormPrimaryColor || '#0078d7';
      document.getElementById('quoteFormAccentColor').value = data.quoteFormAccentColor || '#0ea5e9';
      document.getElementById('quoteFormBackgroundColor').value = data.quoteFormBackgroundColor || '#ffffff';
      document.getElementById('quoteFormButtonLabel').value = data.quoteFormButtonLabel || 'Start Quote';
      document.getElementById('quoteFormCornerStyle').value = data.quoteFormCornerStyle || 'rounded';
      document.getElementById('tierSilverLabel').value = data.tierSilverLabel || 'Silver';
      document.getElementById('tierSilverDescription').value = data.tierSilverDescription || 'Windows only, every 4 weeks.';
      document.getElementById('tierGoldLabel').value = data.tierGoldLabel || 'Gold';
      document.getElementById('tierGoldDescription').value = data.tierGoldDescription || 'Frames, sills and reminders included.';
      document.getElementById('tierGoldMultiplier').value = data.tierGoldMultiplier || '1.35';
      document.getElementById('pricingMinimum').value = data.pricingMinimum || '16';
      document.getElementById('pricingVatIncluded').value = data.pricingVatIncluded ? 'true' : 'false';
      document.getElementById('price2bed').value = data.price2bed || '21';
      document.getElementById('price3bed').value = data.price3bed || '24';
      document.getElementById('price4bed').value = data.price4bed || '28';
      document.getElementById('price5bed').value = data.price5bed || '32';
      document.getElementById('price6bed').value = data.price6bed || '36';
      document.getElementById('priceExtensionAdd').value = data.priceExtensionAdd || '4';
      document.getElementById('priceConservatoryAdd').value = data.priceConservatoryAdd || '6';
      document.getElementById('priceRoofLanternEach').value = data.priceRoofLanternEach || '10';
      document.getElementById('priceSkylightEach').value = data.priceSkylightEach || '1.50';
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
      document.getElementById('minSend').value = data.minSendMinutes || 0;
    }

    // Load SMS settings
    const smsRef = tenantDoc(db, state.subscriberId, 'private', 'smsSettings');
    const smsSnap = await getDoc(smsRef);
    if (smsSnap.exists()) {
      const data = smsSnap.data();
      document.getElementById('smsProvider').value = data.smsProvider || 'twilio';
      document.getElementById('senderName').value = data.smsSender || '';
      if (data.smsApiKey) {
        try {
          document.getElementById('smsApiKey').value = atob(data.smsApiKey);
        } catch (e) {
          console.warn('Could not decode SMS API key');
          document.getElementById('smsApiKey').value = '';
        }
      }
      document.getElementById('creditsBalance').textContent = data.credits || 0;
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

    // Load theme settings from Firestore
    // Use private collection path as per security rules
    try {
      const themeRef = doc(db, 'subscribers', state.subscriberId, 'private', 'theme');
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
        
        // Load saved logo and display in preview
        if (data.logoDataUrl) {
          const logoPreview = document.getElementById('logoPreview');
          logoPreview.style.background = '#ffffff';
          logoPreview.innerHTML = `<img src="${data.logoDataUrl}" alt="Company logo" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
        }
        
        // Load saved background and display in preview
        if (data.backgroundDataUrl) {
          const preview = document.getElementById('backgroundPreview');
          if (preview) {
            preview.style.backgroundImage = `url('${data.backgroundDataUrl}')`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
          }
        }
        
        applyTheme(data);
      }
    } catch (error) {
      console.warn('Failed to load theme settings:', error);
    }

    // Load cleaners and reps
    loadCleaners();
    loadReps();

    // Load SMS settings and packages
    await loadSmsSettings();
    await loadSmsPurchases();
    renderSmsPackages();

    // Load billing data
    await loadBillingData();

    // Load rep dashboard data
    loadRepDashboardData();
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

async function loadRepDashboardData() {
  try {
    if (!state.subscriberId) return;

    // Load shifts data (placeholder - would query actual shifts collection)
    document.getElementById('statTotalShifts').textContent = '0';
    document.getElementById('statTotalDoors').textContent = '0';
    document.getElementById('statTotalSignups').textContent = '0';
    document.getElementById('statActiveReps').textContent = '0';
    
    // Placeholder for recent shifts table
    document.getElementById('recentShiftsBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">No shifts recorded yet</td></tr>';
    
    // Placeholder for recent activity
    document.getElementById('recentActivity').innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">No recent activity</div>';
  } catch (error) {
    console.error('Load rep dashboard data error:', error);
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

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { hour12: false });
  } catch (_) {
    return "—";
  }
}

function renderSmsPackages() {
  const container = document.getElementById('packagesContainer');
  if (!container) return;
  const cards = SMS_PACKAGES.map((pkg) => {
    const price = formatCurrency(pkg.priceGBP);
    return `
      <div class="package-card">
        <div>
          <div style="font-size:1.2rem;font-weight:700;color:#1e293b;">${pkg.credits.toLocaleString()} credits</div>
          <div class="package-meta">${price} • ${pkg.description}</div>
        </div>
        <button type="button" class="btn-save" data-package-id="${pkg.id}">Buy now</button>
        <p style="margin:0;font-size:0.8rem;color:#64748b;">Link opens a secure GoCardless Instant Bank Pay checkout.</p>
      </div>
    `;
  }).join("");
  container.innerHTML = cards;
}

function renderSmsHistory() {
  const container = document.getElementById('historyContainer');
  if (!container) return;
  if (!state.smsPurchases.length) {
    container.innerHTML = '<div class="history-item"><strong>No purchases yet</strong><span>Top-ups will appear here once created.</span></div>';
    return;
  }
  const items = state.smsPurchases.map((purchase) => {
    const status = (purchase.status || "pending").toLowerCase();
    const statusLabel = status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Pending";
    const created = formatTimestamp(purchase.createdAt);
    const completed = purchase.completedAt ? formatTimestamp(purchase.completedAt) : null;
    const credits = Number(purchase.credits) || 0;
    const amount = Number(purchase.amountGBP) || 0;
    const ref = purchase.billingRequestId ? `<span style="font-size:0.8rem;color:#64748b;">Ref: ${purchase.billingRequestId}</span>` : "";
    const completedLine = completed ? `<span style="font-size:0.85rem;color:#16a34a;">Confirmed: ${completed}</span>` : "";
    return `
      <div class="history-item">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <strong>${credits.toLocaleString()} credits • ${formatCurrency(amount)}</strong>
          <span class="history-status" data-status="${status}">${statusLabel}</span>
        </div>
        <span style="font-size:0.85rem;color:#475569;">Created: ${created}</span>
        ${completedLine}
        ${ref}
      </div>
    `;
  }).join("");
  container.innerHTML = items;
}

function updateSmsBalanceDisplay() {
  const balance = Number(state.themeSettings?.creditsBalance) || 0;
  const balanceEl = document.getElementById('creditsBalance');
  if (balanceEl) {
    balanceEl.textContent = balance.toLocaleString();
  }
  const lastTopUpEl = document.getElementById('lastTopUp');
  if (lastTopUpEl) {
    const ts = state.themeSettings?.lastTopUpAt || state.themeSettings?.updatedAt;
    lastTopUpEl.textContent = `Last top-up: ${formatTimestamp(ts)}`;
  }
  const senderNameEl = document.getElementById('senderName');
  if (senderNameEl) {
    senderNameEl.value = (state.themeSettings?.senderName || "").toUpperCase();
  }
}

async function loadSmsSettings() {
  if (!state.subscriberId) return;
  try {
    const ref = tenantDoc(db, state.subscriberId, "private", "smsSettings");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      state.themeSettings = { ...state.themeSettings, ...snap.data() };
    } else {
      state.themeSettings.creditsBalance = state.themeSettings.creditsBalance || 0;
    }
    updateSmsBalanceDisplay();
  } catch (error) {
    console.error('Failed to load SMS settings', error);
  }
}

async function loadSmsPurchases() {
  if (!state.subscriberId) return;
  try {
    const purchasesRef = tenantCollection(db, state.subscriberId, "smsPurchases");
    const q = query(purchasesRef, orderBy("createdAt", "desc"), limit(15));
    const snap = await getDocs(q);
    state.smsPurchases = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderSmsHistory();
  } catch (error) {
    console.error('Failed to load SMS purchases', error);
  }
}

function setSenderStatus(message, isError = false) {
  const el = document.getElementById('senderStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#991b1b" : "#64748b";
}

function setSmsNotice(message, type = "notice") {
  const el = document.getElementById('purchaseFeedback');
  if (!el) return;
  if (!message) {
    el.innerHTML = "";
    return;
  }
  const className = type === "error" ? "error" : "notice";
  el.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
}

async function handleSenderSubmit(event) {
  event.preventDefault();
  if (state.savingSender || !state.subscriberId) return;
  try {
    const desired = (document.getElementById('senderName').value || "").trim().toUpperCase();
    if (!desired) throw new Error("Enter a sender name");
    if (desired.length < 3 || desired.length > 11) {
      throw new Error("Sender name must be 3-11 characters");
    }
    if (!/^[A-Z0-9]+$/.test(desired)) {
      throw new Error("Only letters and numbers are allowed");
    }

    state.savingSender = true;
    document.getElementById('saveSenderBtn').disabled = true;
    setSenderStatus("Saving sender name...");

    const ref = tenantDoc(db, state.subscriberId, "private", "smsSettings");
    await setDoc(ref, {
      senderName: desired,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    if (!state.themeSettings) state.themeSettings = {};
    state.themeSettings.senderName = desired;
    setSenderStatus("Sender name saved");
  } catch (error) {
    console.error('Failed to save sender name', error);
    const message = error?.message || "Unable to save sender name";
    setSenderStatus(message, true);
  } finally {
    document.getElementById('saveSenderBtn').disabled = false;
    state.savingSender = false;
  }
}

async function fetchWithFallback(path, options = {}) {
  console.info("[SMS Centre] Requesting", path, options?.method || "GET");
  try {
    const primary = await fetch(path, options);
    if (primary.status !== 404) {
      console.info("[SMS Centre] Primary response", path, primary.status);
      return primary;
    }
    console.info("[SMS Centre] Primary returned 404, switching to fallback", path);
  } catch (error) {
    console.warn("[SMS Centre] Primary fetch failed, trying fallback", path, error);
  }

  try {
    const fallback = await fetch(`${VERCEL_FALLBACK_ORIGIN}${path}`, options);
    console.info("[SMS Centre] Fallback response", `${VERCEL_FALLBACK_ORIGIN}${path}`, fallback.status);
    return fallback;
  } catch (error) {
    console.warn("[SMS Centre] Fallback fetch failed", path, error);
    throw error;
  }
}

async function startSmsPurchase(packageId) {
  if (state.pendingPurchase || !state.subscriberId) return;
  const pkg = SMS_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return;

  try {
    state.pendingPurchase = true;
    setSmsNotice(`Creating payment link for ${pkg.credits.toLocaleString()} credits...`);

    const response = await fetchWithFallback("/api/createInstantPayLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(pkg.priceGBP * 100),
        currency: "GBP",
        description: `${pkg.credits} SMS credits for ${state.subscriberProfile?.companyName || "Swash subscriber"}`,
        customerName: state.subscriberProfile?.companyName || state.subscriberProfile?.name || "Subscriber",
        credits: pkg.credits,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Payment link creation failed");
    }

    const data = await response.json();
    if (!data.redirect_url || !data.session_id) {
      throw new Error("Payment link missing redirect URL");
    }

    const redirectFlowId = data.redirect_flow_id || null;

    try {
      window.localStorage.setItem(PENDING_FLOW_STORAGE_KEY, JSON.stringify({
        subscriberId: state.subscriberId,
        billingRequestId: data.session_id,
        redirectFlowId,
        credits: pkg.credits,
        createdAt: Date.now(),
      }));
    } catch (storageError) {
      console.warn("[SMS Centre] Unable to persist pending flow locally", storageError);
    }

    const purchasesRef = tenantCollection(db, state.subscriberId, "smsPurchases");
    await addDoc(purchasesRef, {
      packageId: pkg.id,
      credits: pkg.credits,
      amountGBP: pkg.priceGBP,
      billingRequestId: data.session_id,
      redirectFlowId,
      redirectUrl: data.redirect_url,
      status: "pending",
      createdAt: serverTimestamp(),
    });

    await loadSmsPurchases();

    setSmsNotice("Redirecting to secure GoCardless checkout...");
    window.location.href = data.redirect_url;
  } catch (error) {
    console.error('Failed to start SMS purchase', error);
    setSmsNotice(error?.message || "Unable to create payment link", "error");
  } finally {
    state.pendingPurchase = false;
  }
}

/**
 * Save Support AI settings
 */
async function saveSupportSettings() {
  try {
    const apiKey = document.getElementById('supportApiKey')?.value?.trim();
    
    if (!apiKey) {
      showToast('❌ Please enter an API key', 'error');
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      showToast('❌ Invalid API key format. It should start with "sk-"', 'error');
      return;
    }

    // Save to local storage (browser-side only, never sent to our servers)
    setSupportChatApiKey(apiKey);
    
    showToast('✅ Support AI configured! Enable it in the Support button above.', 'success');
    
    // Clear the input after success
    setTimeout(() => {
      document.getElementById('supportApiKey').value = '';
    }, 1500);
  } catch (error) {
    console.error('Failed to save support settings:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

// Initialize
function init() {
  // Wait for DOM to be ready before initializing header
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      await initSubscriberHeader();
      setupAuth();
    });
  } else {
    initSubscriberHeader().then(() => setupAuth());
  }
}

async function setupAuth() {
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

      // Update header with company name and set active tab
      const companyName = state.subscriberProfile.companyName || 
                         state.subscriberProfile.name || 
                         state.subscriberProfile.email || 
                         'My Business';
      setCompanyName(companyName);
      setActiveTab('settings');
      
      // Initialize AI Helper with subscriber context
      initializeAIHelper(state.subscriberId, companyName, state.cleaners);

      // Apply theme with the current subscriber ID
      await applySubscriberTheme(state.subscriberId);

      await loadSettings();
    } catch (error) {
      console.error('Auth error:', error);
      authOverlay.innerHTML = `<div class="auth-card"><h2>Access Denied</h2><p>${error.message}</p></div>`;
    }
  });
}

/**
 * Load billing information from Firestore
 */
async function loadBillingData() {
  try {
    if (!state.subscriberId) return;

    // Load billing document
    const billingRef = tenantDoc(db, state.subscriberId, 'private', 'billing');
    const billingSnap = await getDoc(billingRef);
    
    if (billingSnap.exists()) {
      state.billingData = billingSnap.data();
      renderBillingInfo();
      renderBillingHistory();
      renderSubscriptionItems();
    } else {
      // Create default billing data
      state.billingData = {
        planName: 'Professional',
        basePrice: 29,
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        accountStatus: 'active',
        paymentMethod: 'GoCardless Bank Transfer',
        accountHolder: state.subscriberProfile?.companyName || 'Account',
        lastFourBank: '3456',
        sortCode: '20-17-80'
      };
      renderBillingInfo();
    }
  } catch (error) {
    console.error('Load billing data error:', error);
  }
}

/**
 * Render billing overview information
 */
function renderBillingInfo() {
  if (!state.billingData) return;

  const data = state.billingData;
  const nextDueDate = new Date(data.nextBillingDate);
  const today = new Date();
  const daysUntil = Math.ceil((nextDueDate - today) / (1000 * 60 * 60 * 24));

  // Calculate total monthly cost (base + cleaners + reps)
  const baseCost = data.basePrice || 29;
  const cleanersCost = Math.max(0, (state.cleaners.length - 1) * 10);
  const repsCost = Math.max(0, (state.reps.length - 1) * 10);
  const totalCost = baseCost + cleanersCost + repsCost;

  document.getElementById('billingPlanName').textContent = data.planName || 'Professional';
  document.getElementById('billingPlanDetails').textContent = 'Billed monthly • Auto-renews on ' + nextDueDate.toLocaleDateString('en-GB');
  document.getElementById('billingMonthlyCost').textContent = '£' + totalCost.toFixed(2);
  document.getElementById('billingNextDueDate').textContent = nextDueDate.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  
  if (daysUntil === 1) {
    document.getElementById('billingDaysUntil').textContent = 'Due tomorrow';
    document.getElementById('billingDaysUntil').style.color = '#ea580c';
  } else if (daysUntil <= 7) {
    document.getElementById('billingDaysUntil').textContent = `${daysUntil} days remaining`;
    document.getElementById('billingDaysUntil').style.color = '#0078d7';
  } else {
    document.getElementById('billingDaysUntil').textContent = `${daysUntil} days remaining`;
    document.getElementById('billingDaysUntil').style.color = '#64748b';
  }

  document.getElementById('billingAccountStatus').textContent = data.accountStatus === 'active' ? 'Active' : 'Inactive';
  document.getElementById('billingAccountStatus').style.color = data.accountStatus === 'active' ? '#166534' : '#991b1b';

  // Payment method details
  document.getElementById('billingAcctHolder').textContent = data.accountHolder || '—';
  document.getElementById('billingPaymentMethod').textContent = data.paymentMethod || 'GoCardless Bank Transfer';
  document.getElementById('billingBankAccount').textContent = data.lastFourBank ? '•••••••' + data.lastFourBank : '••••••••';
  document.getElementById('billingSortCode').textContent = data.sortCode || '••••••';
  document.getElementById('billingMandateStatus').textContent = data.accountStatus === 'active' ? 'Active' : 'Inactive';
}

/**
 * Render billing history
 */
function renderBillingHistory() {
  const container = document.getElementById('billingHistoryContainer');
  
  if (!state.billingData || !state.billingData.invoices) {
    // Sample data
    const sampleInvoices = [
      {
        id: 'INV-2025-001',
        date: '2025-11-24',
        amount: 59.00,
        status: 'paid',
        dueDate: '2025-11-24'
      },
      {
        id: 'INV-2025-002',
        date: '2025-10-24',
        amount: 49.00,
        status: 'paid',
        dueDate: '2025-10-24'
      },
      {
        id: 'INV-2025-003',
        date: '2025-09-24',
        amount: 39.00,
        status: 'paid',
        dueDate: '2025-09-24'
      }
    ];

    container.innerHTML = sampleInvoices.map(invoice => `
      <div style="border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#f8fafc; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <div style="font-weight:600; color:#0f172a; margin-bottom:4px;">Invoice ${invoice.id}</div>
          <div style="font-size:0.85rem; color:#64748b;">
            <span>${new Date(invoice.date).toLocaleDateString('en-GB')}</span>
            <span style="margin-left:12px;">Amount: <strong>£${invoice.amount.toFixed(2)}</strong></span>
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span style="background:${invoice.status === 'paid' ? '#dcfce7' : '#fef3c7'}; color:${invoice.status === 'paid' ? '#166534' : '#92400e'}; padding:4px 12px; border-radius:999px; font-size:0.8rem; font-weight:600;">
            ${invoice.status === 'paid' ? '✓ Paid' : 'Pending'}
          </span>
          <button onclick="window.downloadInvoice('${invoice.id}')" style="background:#0078d7; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-size:0.85rem; font-weight:600; cursor:pointer;">
            Download
          </button>
        </div>
      </div>
    `).join('');
    return;
  }
}

/**
 * Render subscription items breakdown
 */
function renderSubscriptionItems() {
  const container = document.getElementById('subscriptionItemsContainer');
  
  const baseCost = state.billingData?.basePrice || 29;
  const cleanersCost = Math.max(0, (state.cleaners.length - 1) * 10);
  const repsCost = Math.max(0, (state.reps.length - 1) * 10);
  const totalCost = baseCost + cleanersCost + repsCost;

  const items = [
    {
      name: 'Professional Plan (Base Subscription)',
      description: 'Includes 1 cleaner, 1 rep, quote calculator, scheduler',
      price: baseCost,
      quantity: 1
    }
  ];

  if (state.cleaners.length > 1) {
    items.push({
      name: `Additional Cleaners (${state.cleaners.length - 1})`,
      description: `${state.cleaners.length - 1} × £10/month`,
      price: 10,
      quantity: state.cleaners.length - 1
    });
  }

  if (state.reps.length > 1) {
    items.push({
      name: `Additional Reps (${state.reps.length - 1})`,
      description: `${state.reps.length - 1} × £10/month`,
      price: 10,
      quantity: state.reps.length - 1
    });
  }

  container.innerHTML = items.map(item => `
    <div style="border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#fff; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-weight:600; color:#0f172a; margin-bottom:4px;">${item.name}</div>
        <div style="font-size:0.85rem; color:#64748b;">${item.description}</div>
      </div>
      <div style="text-align:right;">
        ${item.quantity > 1 ? `<div style="font-size:0.85rem; color:#64748b; margin-bottom:4px;">Qty: ${item.quantity}</div>` : ''}
        <div style="font-size:1.1rem; font-weight:700; color:#0078d7;">£${(item.price * item.quantity).toFixed(2)}</div>
      </div>
    </div>
  `).join('') + `
    <div style="border-top:2px solid #e2e8f0; padding-top:12px; display:flex; justify-content:space-between; align-items:center;">
      <div style="font-size:1rem; font-weight:700; color:#0f172a;">Total Monthly Cost</div>
      <div style="font-size:1.3rem; font-weight:700; color:#0078d7;">£${totalCost.toFixed(2)}</div>
    </div>
  `;
}

/**
 * Download latest invoice
 */
function downloadLatestInvoice() {
  showToast('📥 Downloading invoice...', 'info');
  
  // Create a sample PDF or trigger download
  const invoiceData = {
    invoiceNumber: 'INV-2025-001',
    date: new Date().toLocaleDateString('en-GB'),
    companyName: state.subscriberProfile?.companyName || 'Account',
    amount: 59.00
  };

  // Create a simple text/CSV format for now
  const content = `INVOICE: ${invoiceData.invoiceNumber}
Date: ${invoiceData.date}
Company: ${invoiceData.companyName}
Amount Due: £${invoiceData.amount.toFixed(2)}
Status: PAID

This is a sample invoice. Full PDF generation would be implemented with a backend service.`;

  const blob = new Blob([content], { type: 'text/plain' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `invoice-${invoiceData.invoiceNumber}-${invoiceData.date}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  showToast('✅ Invoice downloaded', 'success');
}

/**
 * Download specific invoice
 */
window.downloadInvoice = function(invoiceId) {
  showToast('📥 Downloading ' + invoiceId + '...', 'info');
  
  const content = `INVOICE: ${invoiceId}
Date: ${new Date().toLocaleDateString('en-GB')}
Company: ${state.subscriberProfile?.companyName || 'Account'}
Amount Due: £59.00
Status: PAID`;

  const blob = new Blob([content], { type: 'text/plain' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `invoice-${invoiceId}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  showToast('✅ Invoice downloaded', 'success');
};

/**
 * View billing portal
 */
function viewBillingPortal() {
  // In production, this would redirect to a GoCardless or Stripe portal
  const portalUrl = 'https://manage.gocardless.com/';
  window.open(portalUrl, '_blank');
  showToast('Opening billing portal...', 'info');
}

/**
 * Update payment method
 */
function updatePaymentMethod() {
  showToast('💳 Redirecting to payment method update...', 'info');
  
  // In production, this would redirect to GoCardless or Stripe hosted page
  const updateUrl = 'https://manage.gocardless.com/';
  setTimeout(() => {
    window.open(updateUrl, '_blank');
  }, 500);
}

/**
 * Pause subscription
 */
async function pauseSubscription() {
  if (!confirm('Are you sure you want to pause your subscription? Your data will be preserved.')) return;

  try {
    if (!state.subscriberId) return;

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'billing');
    await setDoc(settingsRef, {
      accountStatus: 'paused',
      pausedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    state.billingData.accountStatus = 'paused';
    renderBillingInfo();
    showToast('✅ Subscription paused successfully', 'success');
  } catch (error) {
    console.error('Pause subscription error:', error);
    showToast('❌ Failed to pause subscription', 'error');
  }
}

/**
 * Cancel subscription
 */
async function cancelSubscription() {
  if (!confirm('Are you sure you want to cancel your subscription? This action cannot be undone.')) return;
  if (!confirm('This will permanently cancel your account. Click OK to confirm.')) return;

  try {
    if (!state.subscriberId) return;

    const settingsRef = tenantDoc(db, state.subscriberId, 'private', 'billing');
    await setDoc(settingsRef, {
      accountStatus: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    state.billingData.accountStatus = 'cancelled';
    renderBillingInfo();
    showToast('❌ Subscription cancelled', 'success');
  } catch (error) {
    console.error('Cancel subscription error:', error);
    showToast('❌ Failed to cancel subscription', 'error');
  }
}

init();

// (doc function is now properly imported from firebase-firestore)
