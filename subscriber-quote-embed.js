import { auth, db } from './firebase-init.js';
import { tenantCollection, tenantDoc } from './lib/subscriber-paths.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  where,
  query
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Get subscriber ID from URL
const urlParams = new URLSearchParams(window.location.search);
const subscriberId = urlParams.get('id');

// State
const state = {
  subscriberId: null,
  subscriberProfile: null,
  quoteFormConfig: null,
  territories: [],
  selectedTerritory: null,
  customSettings: null,
  fieldConfig: {}
};

// Initialize EmailJS
function initEmailJS() {
  try {
    if (window.emailjs) {
      window.emailjs.init('7HZRYXz3JmMciex1L');
      console.log('[EmailJS] Initialized');
    } else {
      setTimeout(initEmailJS, 500);
    }
  } catch (e) {
    console.error('[EmailJS] Init failed', e);
  }
}

// Load subscriber and their quote form configuration
async function loadSubscriberConfig() {
  try {
    if (!subscriberId) {
      throw new Error('No subscriber ID provided in URL');
    }

    // Get subscriber profile
    const subDocRef = tenantDoc(db, subscriberId, 'settings', 'profile');
    const subSnap = await getDoc(subDocRef);
    
    if (!subSnap.exists()) {
      throw new Error('Subscriber not found');
    }

    state.subscriberProfile = subSnap.data();
    state.subscriberId = subscriberId;

    // Get quote form configuration
    try {
      const configDocRef = tenantDoc(db, subscriberId, 'settings', 'quoteFormConfig');
      const configSnap = await getDoc(configDocRef);
      state.quoteFormConfig = configSnap.exists() ? configSnap.data() : getDefaultConfig();
    } catch (e) {
      console.warn('Could not load quote form config, using defaults', e);
      state.quoteFormConfig = getDefaultConfig();
    }

    // Get custom pricing settings
    try {
      const pricingDocRef = tenantDoc(db, subscriberId, 'settings', 'customSettings');
      const pricingSnap = await getDoc(pricingDocRef);
      state.customSettings = pricingSnap.exists() ? pricingSnap.data() : {};
    } catch (e) {
      console.warn('Could not load custom settings', e);
      state.customSettings = {};
    }

    // Get territories
    try {
      const territoriesRef = tenantCollection(db, subscriberId, 'territories');
      const territoriesSnap = await getDocs(territoriesRef);
      state.territories = [];
      territoriesSnap.forEach(doc => {
        state.territories.push({ id: doc.id, ...doc.data() });
      });
    } catch (e) {
      console.warn('Could not load territories', e);
      state.territories = [];
    }

    console.log('Subscriber config loaded:', {
      subscriberId,
      profile: state.subscriberProfile,
      config: state.quoteFormConfig,
      territories: state.territories
    });

    return true;
  } catch (error) {
    console.error('Error loading subscriber config:', error);
    showAlert(error.message || 'Failed to load quote form', 'error');
    return false;
  }
}

// Get default config if none exists
function getDefaultConfig() {
  return {
    enabledFields: {
      customerName: true,
      email: true,
      mobile: true,
      address: true,
      postcode: false,
      houseSize: true,
      houseType: true,
      conservatory: true,
      extension: true,
      alternating: false,
      frontOnly: false,
      roofLanterns: true,
      skylights: true,
      notes: true,
      bookingDate: true
    },
    requiredFields: {
      customerName: true,
      email: true,
      mobile: true,
      address: true,
      houseSize: false,
      houseType: false
    },
    formText: {
      title: 'Get Your Quote',
      subtitle: 'Fast & Easy',
      description: ''
    },
    branding: {
      primaryColor: '#0078d7',
      accentColor: '#0ea5e9',
      backgroundColor: '#ffffff',
      buttonTextColor: '#ffffff',
      cornerStyle: 'rounded',
      logoUrl: '',
      heroImageUrl: ''
    }
  };
}

// Apply styling from config
function applyBranding() {
  const branding = state.quoteFormConfig.branding;
  if (!branding) return;

  const root = document.documentElement;
  root.style.setProperty('--primary-color', branding.primaryColor || '#0078d7');
  root.style.setProperty('--accent-color', branding.accentColor || '#0ea5e9');
  root.style.setProperty('--background-color', branding.backgroundColor || '#ffffff');
  root.style.setProperty('--button-text-color', branding.buttonTextColor || '#ffffff');
  
  const cornerClass = {
    'rounded': '8px',
    'pill': '24px',
    'square': '0px'
  };
  root.style.setProperty('--corner-radius', cornerClass[branding.cornerStyle] || '8px');

  // Apply header text
  const formText = state.quoteFormConfig.formText || {};
  const titleEl = document.getElementById('formTitle');
  const subtitleEl = document.getElementById('formSubtitle');
  
  if (titleEl) titleEl.textContent = formText.title || 'Get Your Quote';
  if (subtitleEl) subtitleEl.textContent = formText.subtitle || 'Fast & Easy';

  // Apply logo if provided
  if (branding.logoUrl) {
    const logoEl = document.getElementById('companyLogo');
    if (logoEl) {
      logoEl.src = branding.logoUrl;
      logoEl.style.display = 'block';
    }
  }
}

// Show/hide fields based on configuration
function applyFieldConfiguration() {
  const enabled = state.quoteFormConfig.enabledFields || {};
  const required = state.quoteFormConfig.requiredFields || {};

  // Hide/show property details section
  const propertyDetailsSection = document.getElementById('propertyDetailsSection');
  const hasPropertyFields = enabled.houseSize || enabled.houseType || enabled.conservatory || 
                            enabled.extension || enabled.roofLanterns || enabled.skylights;
  if (propertyDetailsSection) {
    propertyDetailsSection.style.display = hasPropertyFields ? 'grid' : 'none';
  }

  // Hide/show notes section
  const notesSection = document.getElementById('notesSection');
  if (notesSection) {
    notesSection.style.display = enabled.notes ? 'grid' : 'none';
  }

  // Show/hide booking section
  const bookingSection = document.getElementById('bookingSection');
  if (bookingSection) {
    bookingSection.style.display = enabled.bookingDate || state.territories.length > 0 ? 'grid' : 'none';
  }

  // Show/hide individual fields
  const fields = [
    'customerName', 'email', 'mobile', 'address', 'postcode',
    'houseSize', 'houseType', 'roofLanterns', 'skylights', 'notes', 'bookingDate'
  ];

  fields.forEach(field => {
    const el = document.getElementById(`field-${field}`);
    if (el) {
      el.style.display = enabled[field] ? 'flex' : 'none';
      const input = document.getElementById(field);
      if (input) {
        input.required = required[field] || false;
      }
    }
  });

  // Hide/show addon checkboxes
  ['conservatory', 'extension', 'alternating', 'frontOnly'].forEach(addon => {
    const el = document.getElementById(`field-${addon}`);
    if (el) {
      el.style.display = enabled[addon] ? 'flex' : 'none';
    }
  });
}

// Configure booking section based on territories
function configureBookingSection() {
  const territoriesContainer = document.getElementById('territoriesContainer');
  const noAreasMessage = document.getElementById('noAreasMessage');
  const bookingDateField = document.getElementById('field-bookingDate');

  if (state.territories.length === 0) {
    // No territories - show message
    if (noAreasMessage) noAreasMessage.style.display = 'block';
    if (territoriesContainer) territoriesContainer.style.display = 'none';
    if (bookingDateField) bookingDateField.style.display = 'none';
    return;
  }

  // Show territories
  if (territoriesContainer) territoriesContainer.style.display = 'block';
  if (noAreasMessage) noAreasMessage.style.display = 'none';
  if (bookingDateField) bookingDateField.style.display = 'flex';

  // Populate territory chips
  const territoriesGrid = document.getElementById('territoriesGrid');
  if (territoriesGrid) {
    territoriesGrid.innerHTML = '';
    state.territories.forEach(territory => {
      const chip = document.createElement('div');
      chip.className = 'territory-chip';
      chip.textContent = territory.name || territory.id;
      chip.dataset.territoryId = territory.id;
      chip.addEventListener('click', () => selectTerritory(territory.id, chip));
      territoriesGrid.appendChild(chip);
    });
  }
}

// Select territory
function selectTerritory(territoryId, chipElement) {
  document.querySelectorAll('.territory-chip').forEach(chip => {
    chip.classList.remove('selected');
  });
  chipElement.classList.add('selected');
  state.selectedTerritory = territoryId;

  // Set min date to today
  const bookingDateInput = document.getElementById('bookingDate');
  if (bookingDateInput) {
    const today = new Date().toISOString().split('T')[0];
    bookingDateInput.min = today;
  }
}

// Show price display
function showPriceDisplay() {
  const priceDisplay = document.getElementById('priceDisplay');
  if (priceDisplay) {
    priceDisplay.style.display = 'block';
  }
}

// Calculate price based on form inputs
function calculatePrice() {
  const houseSize = document.getElementById('houseSize')?.value || '3 bed';
  const conservatory = document.getElementById('conservatory')?.checked || false;
  const extension = document.getElementById('extension')?.checked || false;
  const roofLanterns = Number(document.getElementById('roofLanterns')?.value || 0);
  const skylights = Number(document.getElementById('skylights')?.value || 0);
  const alternating = document.getElementById('alternating')?.checked || false;
  const frontOnly = document.getElementById('frontOnly')?.checked || false;

  // Get pricing from custom settings
  const pricing = state.customSettings || {};
  const minimum = Number(pricing.pricingMinimum) || 16;
  
  // Base prices by house size
  const basePrices = {
    '2 bed': Number(pricing.price2bed) || 21,
    '3 bed': Number(pricing.price3bed) || 24,
    '4 bed': Number(pricing.price4bed) || 28,
    '5 bed': Number(pricing.price5bed) || 32,
    '6 bed': Number(pricing.price6bed) || 36
  };

  let price = basePrices[houseSize] || 24;

  // Add-ons
  if (extension) price += Number(pricing.priceExtensionAdd) || 4;
  if (conservatory) price += Number(pricing.priceConservatoryAdd) || 6;
  price += roofLanterns * (Number(pricing.priceRoofLanternEach) || 2);
  price += skylights * (Number(pricing.priceSkylightEach) || 2);

  // Modifiers
  if (alternating) price *= 1.5; // 50% uplift for alternating
  if (frontOnly) price *= 0.75; // 25% discount for front only

  // Apply minimum
  price = Math.max(price, minimum);

  // Update display
  const priceValue = document.getElementById('priceValue');
  if (priceValue) {
    priceValue.textContent = '£' + price.toFixed(2);
  }

  // Update slider displays
  document.getElementById('roofLanternsValue').textContent = roofLanterns;
  document.getElementById('skylightsValue').textContent = skylights;
}

// Show alert message
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alertContainer');
  if (!alertContainer) return;

  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alert.style.gridColumn = '1 / -1';
  alertContainer.appendChild(alert);

  if (type === 'success') {
    setTimeout(() => alert.remove(), 5000);
  }
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    // Collect form data
    const formData = {
      customerName: document.getElementById('customerName').value,
      email: document.getElementById('email').value,
      mobile: document.getElementById('mobile').value,
      address: document.getElementById('address').value,
      postcode: document.getElementById('postcode').value || '',
      houseSize: document.getElementById('houseSize').value || '',
      houseType: document.getElementById('houseType').value || '',
      conservatory: document.getElementById('conservatory')?.checked || false,
      extension: document.getElementById('extension')?.checked || false,
      roofLanterns: Number(document.getElementById('roofLanterns')?.value || 0),
      skylights: Number(document.getElementById('skylights')?.value || 0),
      alternating: document.getElementById('alternating')?.checked || false,
      frontOnly: document.getElementById('frontOnly')?.checked || false,
      notes: document.getElementById('notes')?.value || '',
      bookingDate: document.getElementById('bookingDate')?.value || '',
      territoryId: state.selectedTerritory || '',
      repCode: 'Website Quote',
      status: 'Quoted',
      date: new Date().toISOString(),
      price: parseFloat(document.getElementById('priceValue')?.textContent.replace('£', '') || 0),
      pricePerClean: parseFloat(document.getElementById('priceValue')?.textContent.replace('£', '') || 0)
    };

    // Save to Firestore under subscriber's quotes
    const quotesRef = tenantCollection(db, state.subscriberId, 'quotes');
    const quoteDocRef = await addDoc(quotesRef, {
      ...formData,
      submittedAt: serverTimestamp()
    });

    console.log('Quote saved with ID:', quoteDocRef.id);
    showAlert('✅ Quote submitted successfully! We will be in touch soon.', 'success');

    // Reset form
    document.getElementById('quoteForm').reset();
    calculatePrice();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error('Error submitting quote:', error);
    showAlert('❌ Failed to submit quote: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Initialize app
async function init() {
  try {
    // Load subscriber config
    const loaded = await loadSubscriberConfig();
    if (!loaded) return;

    // Hide loading, show form
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('quoteContainer').style.display = 'block';

    // Apply customizations
    applyBranding();
    applyFieldConfiguration();
    configureBookingSection();
    showPriceDisplay();

    // Attach event listeners
    document.getElementById('quoteForm').addEventListener('submit', handleSubmit);
    
    // Price calculation
    ['houseSize', 'houseType', 'conservatory', 'extension', 'roofLanterns', 'skylights', 'alternating', 'frontOnly']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', calculatePrice);
          el.addEventListener('input', calculatePrice);
        }
      });

    // Initial price calculation
    calculatePrice();
    initEmailJS();
  } catch (error) {
    console.error('Initialization error:', error);
    showAlert('An error occurred while loading the form', 'error');
  }
}

// Start app
init();
