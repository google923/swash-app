import { auth, db } from './public/firebase-init.js';
import { ensureSubscriberAccess } from './lib/subscriber-access.js';
import { tenantCollection, tenantDoc } from './lib/subscriber-paths.js';
import { initSubscriberHeader, setCompanyName, setActiveTab, initializeAIHelper } from './public/header-template.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  query,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
  where,
  orderBy,
  doc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// State
const state = {
  currentUser: null,
  subscriberId: null,
  subscriberProfile: null,
  viewerRole: null,
  quotes: [],
  filteredQuotes: [],
  selectedIds: new Set(),
  currentPage: 1,
  pageSize: 50,
  expandedRows: new Set(),
  customSettings: null,
  cleaners: [],
  territories: []
};

const STATIC_FILTER_OPTIONS = {
  status: [
    { value: 'quoted', label: 'Quoted' },
    { value: 'pending', label: 'Pending Booking' },
    { value: 'booked', label: 'Booked' },
    { value: 'cancelled', label: 'Cancelled' }
  ],
  payment: [
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'overdue', label: 'Overdue' }
  ]
};

// DOM Elements
const authOverlay = document.getElementById('authOverlay');
const mainContent = document.getElementById('mainContent');
const logoutBtn = document.getElementById('logoutBtn');
const toggleQuoteFormBtn = document.getElementById('toggleQuoteForm');
const quoteModal = document.getElementById('quoteModal');
const saveQuoteBtn = document.getElementById('saveQuoteBtn');
const cancelQuoteBtn = document.getElementById('cancelQuoteBtn');
const customersTableBody = document.getElementById('customersTableBody');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const bulkActionsBar = document.getElementById('bulkActionsBar');
const selectedCountSpan = document.getElementById('selectedCount');

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

// Pricing calculator (uses custom settings or defaults)
function calculatePrice() {
  const tier = document.getElementById('serviceTier')?.value || 'gold';
  const houseSize = document.getElementById('houseSize')?.value || '3 bed';
  const houseType = document.getElementById('houseType')?.value || 'Semi-Detached';
  const conservatory = document.getElementById('conservatory')?.checked || false;
  const extension = document.getElementById('extension')?.checked || false;
  const roofLanterns = Number(document.getElementById('roofLanterns')?.value || 0);
  const skylights = Number(document.getElementById('skylights')?.value || 0);
  const alternating = document.getElementById('alternating')?.checked || false;
  const frontOnly = document.getElementById('frontOnly')?.checked || false;

  // Defensive: ensure display spans exist if legacy slider layout is served from cache
  const rlSpan = document.getElementById('roofLanternsValue');
  if (!rlSpan && document.getElementById('roofLanterns')?.parentElement) {
    const span = document.createElement('span');
    span.id = 'roofLanternsValue';
    span.className = 'slider-value';
    span.textContent = String(roofLanterns);
    document.getElementById('roofLanterns').parentElement.appendChild(span);
  } else if (rlSpan) rlSpan.textContent = String(roofLanterns);
  const skSpan = document.getElementById('skylightsValue');
  if (!skSpan && document.getElementById('skylights')?.parentElement) {
    const span = document.createElement('span');
    span.id = 'skylightsValue';
    span.className = 'slider-value';
    span.textContent = String(skylights);
    document.getElementById('skylights').parentElement.appendChild(span);
  } else if (skSpan) skSpan.textContent = String(skylights);

  // Base prices (override with custom settings if available)
  const basePrices = state.customSettings?.pricing || {
    gold: { '2 bed': 15, '3 bed': 20, '4 bed': 25, '5 bed': 30, '6 bed': 35 },
    silver: { '2 bed': 12, '3 bed': 16, '4 bed': 20, '5 bed': 24, '6 bed': 28 }
  };

  let price = basePrices[tier]?.[houseSize] || 20;

  // Adjustments
  if (houseType === 'Detached') price += 5;
  if (conservatory) price += 5;
  if (extension) price += 3;
  price += roofLanterns * 3;
  price += skylights * 2;
  if (alternating) price *= 1.2;
  if (frontOnly) price *= 0.6;

  const resultPanel = document.getElementById('result');
  if (resultPanel) {
    resultPanel.innerHTML = `
      <div class="result-price">£${price.toFixed(2)}</div>
      <p style="margin: 8px 0 0; color: #64748b; font-size: 0.9rem;">Price per clean (every 4 weeks)</p>
    `;
  }

  return price;
}

// Compute next clean dates (28-day cadence)
function computeNextCleanDates(firstISO) {
  try {
    const first = new Date(firstISO);
    if (isNaN(first.getTime())) return [];
    const second = new Date(first.getTime());
    second.setDate(second.getDate() + 28);
    const third = new Date(first.getTime());
    third.setDate(third.getDate() + 56);
    return [second.toISOString(), third.toISOString()];
  } catch { return []; }
}

// Save new quote to tenant-scoped collection
async function saveQuote() {
  try {
    if (!state.subscriberId) {
      alert('Subscriber context not loaded');
      return;
    }

    const customerName = document.getElementById('customerName')?.value?.trim();
    const address = document.getElementById('address')?.value?.trim();
    const mobile = document.getElementById('mobile')?.value?.trim();
    const email = document.getElementById('email')?.value?.trim();

    if (!customerName || !address || !mobile || !email) {
      alert('Please fill in all customer details');
      return;
    }

    const price = calculatePrice();
    const tier = document.getElementById('serviceTier')?.value || 'gold';
    const houseSize = document.getElementById('houseSize')?.value || '3 bed';
    const houseType = document.getElementById('houseType')?.value || 'Semi-Detached';
    const notes = document.getElementById('notes')?.value?.trim() || '';
    const repCode = document.getElementById('repCode')?.value?.trim() || 'Website Quote';
    const territoryId = document.getElementById('territorySelectQuote')?.value || '';
    const bookingDateValue = document.getElementById('bookingDate')?.value || '';
    const quoteOnly = document.getElementById('quoteOnlyCheckbox')?.checked;

    let bookedDate = null;
    let status = 'Quoted';
    let nextCleanDates = [];
    if (!quoteOnly && bookingDateValue) {
      const d = new Date(bookingDateValue);
      if (!isNaN(d.getTime())) {
        bookedDate = d.toISOString();
        status = `Booked - ${formatDate(d)}`;
        nextCleanDates = computeNextCleanDates(bookedDate);
      }
    }

    const quoteData = {
      customerName,
      address,
      mobile,
      email,
      tier,
      houseSize,
      houseType,
      pricePerClean: price,
      price: price * 3, // upfront for 3 cleans
      notes,
      repCode: repCode.toUpperCase(),
      status,
      paymentStatus: 'pending',
      bookedDate,
      nextCleanDates,
      assignedCleaner: null,
      territoryId: territoryId || null,
      date: serverTimestamp(),
      deleted: false,
      refCode: generateRefCode()
    };

    const quotesCol = tenantCollection(db, state.subscriberId, 'quotes');
    await addDoc(quotesCol, quoteData);

    showToast('✅ Quote saved successfully', 'success');
    
    // Reset form
    document.getElementById('quoteForm')?.reset();
    document.getElementById('customerName').value = '';
    document.getElementById('address').value = '';
    document.getElementById('mobile').value = '';
    document.getElementById('email').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('result').innerHTML = '';
    // Close modal
    quoteModal.hidden = true;
    toggleQuoteFormBtn.classList.remove('active');
    
    await loadQuotes();
  } catch (error) {
    console.error('Save quote error:', error);
    alert('Failed to save quote: ' + (error.message || 'Unknown error'));
  }
}

function generateRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = '';
  for (let i = 0; i < 6; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-weight: 600;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Load all quotes from tenant collection
async function loadQuotes() {
  try {
    if (!state.subscriberId) return;

    const quotesCol = tenantCollection(db, state.subscriberId, 'quotes');
    const q = query(quotesCol, orderBy('date', 'desc'));
    const snapshot = await getDocs(q);

    state.quotes = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(quote => !quote.deleted);

    applyFilters();
    renderTable();
    updatePaginationInfo();
    refreshFilterValueOptions();
  } catch (error) {
    console.error('Load quotes error:', error);
    customersTableBody.innerHTML = `
      <tr><td colspan="8" style="text-align: center; padding: 40px; color: #dc2626;">
        Failed to load quotes: ${error.message || 'Unknown error'}
      </td></tr>
    `;
  }
}

// Apply filters
function applyFilters() {
  const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';
  const filterField = document.getElementById('filterFieldSelect')?.value || '';
  const filterValue = document.getElementById('filterValueSelect')?.value || '';

  state.filteredQuotes = state.quotes.filter(quote => {
    // Search
    if (searchTerm) {
      const searchable = [
        quote.customerName,
        quote.email,
        quote.address,
        quote.refCode
      ].join(' ').toLowerCase();
      if (!searchable.includes(searchTerm)) return false;
    }

    if (filterField && filterValue) {
      switch (filterField) {
        case 'status': {
          const quoteStatus = getQuoteStatus(quote).toLowerCase();
          if (quoteStatus !== filterValue) return false;
          break;
        }
        case 'payment': {
          const paymentStatus = getPaymentStatus(quote);
          if (paymentStatus !== filterValue) return false;
          break;
        }
        case 'rep':
          if ((quote.repCode || '') !== filterValue) return false;
          break;
        case 'territory':
          if ((quote.territoryId || '') !== filterValue) return false;
          break;
        default:
          break;
      }
    }

    return true;
  });

  state.currentPage = 1;
}

function getQuoteStatus(quote) {
  if (!quote) return 'quoted';
  const status = (quote.status || '').toLowerCase();
  if (status.includes('booked')) return 'booked';
  if (status.includes('pending')) return 'pending';
  if (status.includes('cancelled')) return 'cancelled';
  return 'quoted';
}

function getPaymentStatus(quote) {
  if (!quote) return 'pending';
  if (quote.paymentStatus === 'paid') return 'paid';
  if (quote.bookedDate && !quote.paymentStatus) {
    // Check if overdue (more than 7 days past booked date)
    const bookedDate = new Date(quote.bookedDate);
    const now = new Date();
    const daysDiff = Math.floor((now - bookedDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 7) return 'overdue';
  }
  return 'pending';
}

function refreshFilterValueOptions() {
  const fieldSelect = document.getElementById('filterFieldSelect');
  const valueSelect = document.getElementById('filterValueSelect');
  if (!valueSelect) return;

  const field = fieldSelect?.value || '';
  valueSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select an option';
  valueSelect.appendChild(placeholder);

  if (!field) {
    valueSelect.disabled = true;
    return;
  }

  let options = [];
  if (STATIC_FILTER_OPTIONS[field]) {
    options = STATIC_FILTER_OPTIONS[field];
  } else if (field === 'rep') {
    const repCodes = [...new Set(state.quotes.map(q => q.repCode).filter(Boolean))];
    options = repCodes.map(code => ({ value: code, label: code }));
  } else if (field === 'territory') {
    options = state.territories.map(territory => ({
      value: territory.id,
      label: territory.name || territory.id
    }));
  }

  if (!options.length) {
    valueSelect.disabled = true;
    placeholder.textContent = 'No options available';
    return;
  }

  valueSelect.disabled = false;
  options.forEach(optionData => {
    const option = document.createElement('option');
    option.value = optionData.value;
    option.textContent = optionData.label;
    valueSelect.appendChild(option);
  });
}

// Render table with pagination
function renderTable() {
  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;
  const pageQuotes = state.filteredQuotes.slice(start, end);

  if (pageQuotes.length === 0) {
    customersTableBody.innerHTML = `
      <tr><td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
        ${state.quotes.length === 0 ? 'No quotes yet. Click "+ New Quote" to get started.' : 'No quotes match your filters.'}
      </td></tr>
    `;
    return;
  }

  const rows = pageQuotes.map(quote => {
    const isExpanded = state.expandedRows.has(quote.id);
    const isSelected = state.selectedIds.has(quote.id);
    const status = getQuoteStatus(quote);
    const paymentStatus = getPaymentStatus(quote);
    
    let mainRow = `
      <tr class="expandable-row ${isSelected ? 'selected' : ''}" data-quote-id="${quote.id}">
        <td><input type="checkbox" class="row-checkbox" data-id="${quote.id}" ${isSelected ? 'checked' : ''} /></td>
        <td><strong>${escapeHtml(quote.customerName || 'N/A')}</strong><br><small style="color: #64748b;">${escapeHtml(quote.address || '')}</small></td>
        <td>${escapeHtml(quote.email || 'N/A')}</td>
        <td><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
        <td><strong>£${(quote.pricePerClean || 0).toFixed(2)}</strong></td>
        <td><span class="payment-status payment-${paymentStatus}">${paymentStatus.toUpperCase()}</span></td>
        <td style="position:relative;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>${formatDate(quote.date)}</span>
            <button title="Show all info / edit" class="expand-btn" data-id="${quote.id}" style="background:none;border:none;cursor:pointer;color:#0078d7;font-size:14px;padding:4px 6px;">${isExpanded ? '▼' : '▶'}</button>
          </div>
        </td>
      </tr>
    `;

    if (isExpanded) {
      mainRow += renderExpandedRow(quote);
    }

    return mainRow;
  }).join('');

  customersTableBody.innerHTML = rows;
}

function renderExpandedRow(quote) {
  // Allow editing all fields except refCode always; booked customers can still edit contact & notes
  const canEdit = true;
  const territoryOptions = state.territories.map(t => `<option value="${t.id}" ${quote.territoryId === t.id ? 'selected' : ''}>${escapeHtml(t.name || t.id)}</option>`).join('');
  
  return `
    <tr class="expanded-details" data-detail-for="${quote.id}">
      <td colspan="7">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px;">
            <span style="display:block; font-size:0.75rem; font-weight:600; color:#475569; margin-bottom:6px; text-transform:uppercase;">Reference</span>
            <span style="font-size:1rem; font-weight:600; color:#0f172a;">${escapeHtml(quote.refCode || 'N/A')}</span>
          </div>
          <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px;">
            <span style="display:block; font-size:0.75rem; font-weight:600; color:#475569; margin-bottom:6px; text-transform:uppercase;">Booked Date</span>
            <span style="font-size:1rem; font-weight:600; color:#0f172a;">${quote.bookedDate ? formatDate(quote.bookedDate) : 'Not booked'}</span>
          </div>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Customer Name</span>
            <span class="detail-value">${canEdit ? `<input type="text" class="edit-field" data-field="customerName" data-id="${quote.id}" value="${escapeHtml(quote.customerName || '')}" />` : escapeHtml(quote.customerName || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Address</span>
            <span class="detail-value">${canEdit ? `<input type="text" class="edit-field" data-field="address" data-id="${quote.id}" value="${escapeHtml(quote.address || '')}" />` : escapeHtml(quote.address || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Mobile</span>
            <span class="detail-value">
              ${canEdit ? 
                `<input type="text" class="edit-field" data-field="mobile" data-id="${quote.id}" value="${escapeHtml(quote.mobile || '')}" />` :
                escapeHtml(quote.mobile || 'N/A')
              }
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Email</span>
            <span class="detail-value">${canEdit ? `<input type="email" class="edit-field" data-field="email" data-id="${quote.id}" value="${escapeHtml(quote.email || '')}" />` : escapeHtml(quote.email || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Tier</span>
            <span class="detail-value">${canEdit ? `<select class="edit-field" data-field="tier" data-id="${quote.id}"><option value="gold" ${quote.tier==='gold'?'selected':''}>gold</option><option value="silver" ${quote.tier==='silver'?'selected':''}>silver</option></select>` : escapeHtml(quote.tier || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">House Size</span>
            <span class="detail-value">${canEdit ? `<select class="edit-field" data-field="houseSize" data-id="${quote.id}"><option>2 bed</option><option ${quote.houseSize==='3 bed'?'selected':''}>3 bed</option><option ${quote.houseSize==='4 bed'?'selected':''}>4 bed</option><option ${quote.houseSize==='5 bed'?'selected':''}>5 bed</option><option ${quote.houseSize==='6 bed'?'selected':''}>6 bed</option></select>` : escapeHtml(quote.houseSize || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">House Type</span>
            <span class="detail-value">${canEdit ? `<select class="edit-field" data-field="houseType" data-id="${quote.id}"><option value="Bungalow" ${quote.houseType==='Bungalow'?'selected':''}>Bungalow</option><option value="Maisonette" ${quote.houseType==='Maisonette'?'selected':''}>Maisonette</option><option value="Terrace" ${quote.houseType==='Terrace'?'selected':''}>Terrace</option><option value="Semi-Detached" ${quote.houseType==='Semi-Detached'?'selected':''}>Semi-Detached</option><option value="Detached" ${quote.houseType==='Detached'?'selected':''}>Detached</option><option value="Mobile Home" ${quote.houseType==='Mobile Home'?'selected':''}>Mobile Home</option></select>` : escapeHtml(quote.houseType || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Source</span>
            <span class="detail-value">${canEdit ? `<input type="text" class="edit-field" data-field="repCode" data-id="${quote.id}" value="${escapeHtml(quote.repCode || '')}" />` : escapeHtml(quote.repCode || 'N/A')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Territory</span>
            <span class="detail-value">${canEdit ? `<select class="edit-field" data-field="territoryId" data-id="${quote.id}"><option value="">Unassigned</option>${territoryOptions}</select>` : getTerritoryName(quote.territoryId)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Assigned Cleaner</span>
            <span class="detail-value">
              ${canEdit ?
                `<select class="edit-field" data-field="assignedCleaner" data-id="${quote.id}">
                  <option value="">Unassigned</option>
                  ${state.cleaners.map(c => `<option value="${c.id}" ${quote.assignedCleaner === c.id ? 'selected' : ''}>${escapeHtml(c.name || c.id)}</option>`).join('')}
                </select>` :
                (quote.assignedCleaner || 'Unassigned')
              }
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Price/Clean (£)</span>
            <span class="detail-value">${canEdit ? `<input type="number" step="0.01" class="edit-field" data-field="pricePerClean" data-id="${quote.id}" value="${(quote.pricePerClean||0)}" />` : `£${(quote.pricePerClean||0).toFixed(2)}`}</span>
          </div>
          <div class="detail-item" style="grid-column: 1 / -1;">
            <span class="detail-label">Notes</span>
            <span class="detail-value">
              ${canEdit ?
                `<textarea class="edit-field" data-field="notes" data-id="${quote.id}" rows="3">${escapeHtml(quote.notes || '')}</textarea>` :
                escapeHtml(quote.notes || 'No notes')
              }
            </span>
          </div>
        </div>
        ${canEdit ? `
          <div class="detail-actions">
            <button class="btn btn-primary btn-sm save-changes-btn" data-id="${quote.id}">💾 Save Changes</button>
            <button class="btn btn-success btn-sm book-customer-btn" data-id="${quote.id}">📅 Book This Customer</button>
            <button class="btn btn-secondary btn-sm message-customer-btn" data-id="${quote.id}">✉️ Send Message</button>
            <button class="btn btn-danger btn-sm cancel-quote-btn" data-id="${quote.id}">❌ Cancel Quote</button>
          </div>
        ` : ''}
      </td>
    </tr>
  `;
}

function getTerritoryName(territoryId) {
  if (!territoryId) return 'N/A';
  const territory = state.territories.find(t => t.id === territoryId);
  return escapeHtml(territory?.name || territoryId);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(date) {
  if (!date) return 'N/A';
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (e) {
    return 'N/A';
  }
}

function updatePaginationInfo() {
  const total = state.filteredQuotes.length;
  const start = (state.currentPage - 1) * state.pageSize + 1;
  const end = Math.min(start + state.pageSize - 1, total);
  document.getElementById('paginationInfo').textContent = 
    total === 0 ? 'Showing 0 results' : `Showing ${start}-${end} of ${total} results`;
  
  document.getElementById('prevPageBtn').disabled = state.currentPage === 1;
  document.getElementById('nextPageBtn').disabled = end >= total;
}

// Load and apply field configuration from settings
async function applyFieldConfiguration() {
  try {
    if (!state.subscriberId) return;

    // Try to load quoteFormConfig
    const configDocRef = doc(db, 'subscribers', state.subscriberId, 'settings', 'quoteFormConfig');
    const configSnap = await getDoc(configDocRef);
    
    if (!configSnap.exists()) {
      console.log('No field configuration found, showing all fields');
      return;
    }

    const config = configSnap.data();
    const enabledFields = config.enabledFields || {};
    const requiredFields = config.requiredFields || {};

    console.log('🎨 Applying field configuration:', enabledFields);

    // Define field mappings: fieldId -> DOM element ID
    const fieldMappings = {
      houseSize: 'houseSize',
      houseType: 'houseType',
      conservatory: 'conservatory',
      extension: 'extension',
      alternating: 'alternating',
      frontOnly: 'frontOnly',
      roofLanterns: 'roofLanterns',
      skylights: 'skylights',
      notes: 'notes'
    };

    // Show/hide fields based on configuration
    Object.entries(fieldMappings).forEach(([configKey, elementId]) => {
      const element = document.getElementById(elementId);
      if (element) {
        const isEnabled = enabledFields[configKey] !== false; // Default to enabled
        const isRequired = requiredFields[configKey] === true;
        
        // Show/hide the field wrapper
        const parentSection = element.closest('.modal__grid') || element.closest('div');
        if (parentSection) {
          parentSection.style.display = isEnabled ? 'block' : 'none';
        }

        // Set required attribute
        if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
          element.required = isRequired;
        }

        console.log(`Field ${elementId}: enabled=${isEnabled}, required=${isRequired}`);
      }
    });

  } catch (error) {
    console.warn('Could not load field configuration:', error);
    // Silently fail - show all fields if config doesn't exist
  }
}

// Event Listeners
function attachEventListeners() {
  // Re-query DOM elements to ensure they exist (fixes timing issues)
  const _toggleQuoteFormBtn = document.getElementById('toggleQuoteForm');
  const _quoteModal = document.getElementById('quoteModal');
  const _saveQuoteBtn = document.getElementById('saveQuoteBtn');
  const _cancelQuoteBtn = document.getElementById('cancelQuoteBtn');
  
  // Tab switching
  document.querySelectorAll('.header-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      
      if (tabName === 'schedule') {
        window.location.href = '/schedule.html';
      } else if (tabName === 'tracking') {
        window.location.href = '/subscriber-tracking.html';
      } else if (tabName === 'settings') {
        window.location.href = '/subscriber-settings.html';
      }
      // 'quotes' stays on current page
    });
  });

  // Toggle quote form
  _toggleQuoteFormBtn?.addEventListener('click', () => {
    if (_quoteModal.hidden) {
      _quoteModal.hidden = false;
      _toggleQuoteFormBtn.classList.add('active');
      calculatePrice();
      populateTerritorySelectQuote();
    } else {
      _quoteModal.hidden = true;
      _toggleQuoteFormBtn.classList.remove('active');
    }
  });

  // Save quote
  _saveQuoteBtn?.addEventListener('click', saveQuote);

  // Cancel quote form
  _cancelQuoteBtn?.addEventListener('click', () => {
    _quoteModal.hidden = true;
    _toggleQuoteFormBtn.classList.remove('active');
  });

  // Pricing calculator auto-update
  ['serviceTier', 'houseSize', 'houseType', 'conservatory', 'extension', 
   'roofLanterns', 'skylights', 'alternating', 'frontOnly'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', calculatePrice);
    document.getElementById(id)?.addEventListener('input', calculatePrice);
  });

  // Slider value displays
  document.getElementById('roofLanterns')?.addEventListener('input', (e) => {
    const span = document.getElementById('roofLanternsValue');
    if (span) span.textContent = e.target.value;
    calculatePrice();
  });
  document.getElementById('skylights')?.addEventListener('input', (e) => {
    const span = document.getElementById('skylightsValue');
    if (span) span.textContent = e.target.value;
    calculatePrice();
  });

  // Select all checkbox
  selectAllCheckbox?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    const pageQuotes = state.filteredQuotes.slice(
      (state.currentPage - 1) * state.pageSize,
      state.currentPage * state.pageSize
    );
    
    if (checked) {
      pageQuotes.forEach(q => state.selectedIds.add(q.id));
    } else {
      pageQuotes.forEach(q => state.selectedIds.delete(q.id));
    }
    
    updateBulkActionsBar();
    renderTable();
  });

  // Table event delegation
  customersTableBody?.addEventListener('click', async (e) => {
    const target = e.target;
    const quoteId = target.dataset.id;

    // Expand/collapse
    if (target.classList.contains('expand-btn')) {
      if (state.expandedRows.has(quoteId)) {
        state.expandedRows.delete(quoteId);
      } else {
        state.expandedRows.add(quoteId);
      }
      renderTable();
      return;
    }

    // Row checkbox
    if (target.classList.contains('row-checkbox')) {
      if (target.checked) {
        state.selectedIds.add(quoteId);
      } else {
        state.selectedIds.delete(quoteId);
      }
      updateBulkActionsBar();
      return;
    }

    // Save changes
    if (target.classList.contains('save-changes-btn')) {
      await saveQuoteChanges(quoteId);
      return;
    }

    // Book customer
    if (target.classList.contains('book-customer-btn')) {
      await bookSingleCustomer(quoteId);
      return;
    }

    // Message customer
    if (target.classList.contains('message-customer-btn')) {
      await messageSingleCustomer(quoteId);
      return;
    }

    // Cancel quote
    if (target.classList.contains('cancel-quote-btn')) {
      await cancelQuote(quoteId);
      return;
    }
  });

  // Filters
  document.getElementById('filterFieldSelect')?.addEventListener('change', () => {
    const filterValueSelect = document.getElementById('filterValueSelect');
    if (filterValueSelect) filterValueSelect.value = '';
    refreshFilterValueOptions();
  });

  document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
    applyFilters();
    renderTable();
    updatePaginationInfo();
  });

  document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    const fieldSelect = document.getElementById('filterFieldSelect');
    if (fieldSelect) fieldSelect.value = '';
    refreshFilterValueOptions();
    applyFilters();
    renderTable();
    updatePaginationInfo();
  });

  // Pagination
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderTable();
      updatePaginationInfo();
    }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    const maxPage = Math.ceil(state.filteredQuotes.length / state.pageSize);
    if (state.currentPage < maxPage) {
      state.currentPage++;
      renderTable();
      updatePaginationInfo();
    }
  });

  // Bulk actions
  document.getElementById('bulkBookBtn')?.addEventListener('click', () => {
    if (state.selectedIds.size === 0) {
      alert('Please select at least one customer');
      return;
    }
    showBulkBookingModal();
  });

  document.getElementById('bulkMessageBtn')?.addEventListener('click', () => {
    if (state.selectedIds.size === 0) {
      alert('Please select at least one customer');
      return;
    }
    showBulkMessageModal();
  });

  document.getElementById('clearSelectionBtn')?.addEventListener('click', () => {
    state.selectedIds.clear();
    updateBulkActionsBar();
    renderTable();
  });

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    try {
      await signOut(auth);
      window.location.href = '/subscriber-login.html';
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to sign out');
    }
  });

  // Modal buttons (registered once)
  document.getElementById('cancelBulkBookingBtn')?.addEventListener('click', closeBulkBookingModal);
  document.getElementById('confirmBulkBookingBtn')?.addEventListener('click', confirmBulkBooking);
  document.getElementById('cancelBulkMessageBtn')?.addEventListener('click', closeBulkMessageModal);
  document.getElementById('sendBulkMessageBtn')?.addEventListener('click', sendBulkMessages);
  document.getElementById('cancelSingleMessageBtn')?.addEventListener('click', () => document.getElementById('singleMessageModal').hidden = true);
  document.getElementById('sendSingleMessageBtn')?.addEventListener('click', sendSingleMessage);

  // Bulk Export CSV button
  document.getElementById('bulkExportBtn')?.addEventListener('click', () => {
    if (state.selectedIds.size === 0) {
      alert('Please select at least one customer');
      return;
    }
    exportSelectedToCSV();
  });
}

function updateBulkActionsBar() {
  selectedCountSpan.textContent = state.selectedIds.size;
  if (state.selectedIds.size > 0) {
    bulkActionsBar.classList.add('active');
    updateSelectedCustomersModal();
  } else {
    bulkActionsBar.classList.remove('active');
    document.getElementById('selectedCustomersModal').style.display = 'none';
  }
}

function updateSelectedCustomersModal() {
  const modal = document.getElementById('selectedCustomersModal');
  const container = document.getElementById('selectedCustomersListContainer');
  
  if (state.selectedIds.size === 0) {
    modal.style.display = 'none';
    return;
  }

  const selectedQuotes = state.quotes.filter(q => state.selectedIds.has(q.id));
  let html = '';
  
  selectedQuotes.forEach(quote => {
    const price = quote.pricePerClean || quote.price || 'N/A';
    html += `
      <div style="padding:8px; border-bottom:1px solid #f0f0f0; font-size:0.8rem;">
        <div style="font-weight:600; color:#0f172a;">${escapeHtml(quote.customerName || 'N/A')}</div>
        <div style="color:#64748b; margin-top:2px;">${escapeHtml(quote.address || 'No address')}</div>
        <div style="color:#0078d7; font-weight:600; margin-top:4px;">£${typeof price === 'number' ? price.toFixed(2) : price}</div>
      </div>
    `;
  });

  container.innerHTML = html;
  modal.style.display = 'block';
}

async function saveQuoteChanges(quoteId) {
  try {
    const updates = {};
    const fields = document.querySelectorAll(`.edit-field[data-id="${quoteId}"]`);
    fields.forEach(field => {
      const fieldName = field.dataset.field;
      let val = field.value;
      if (fieldName === 'repCode') val = val.toUpperCase();
      if (fieldName === 'pricePerClean') val = parseFloat(val || '0');
      updates[fieldName] = val;
    });

    // Pricing recalculation if structural fields changed
    if (updates.tier || updates.houseSize || updates.houseType) {
      const quoteRef = tenantDoc(db, state.subscriberId, 'quotes', quoteId);
      const snap = await getDoc(quoteRef);
      if (snap.exists()) {
        const current = snap.data();
        const merged = { ...current, ...updates };
        const basePrices = state.customSettings?.pricing || {
          gold: { '2 bed': 15, '3 bed': 20, '4 bed': 25, '5 bed': 30, '6 bed': 35 },
          silver: { '2 bed': 12, '3 bed': 16, '4 bed': 20, '5 bed': 24, '6 bed': 28 }
        };
        let newPrice = basePrices[merged.tier]?.[merged.houseSize] || 20;
        if (merged.houseType === 'Detached') newPrice += 5;
        updates.pricePerClean = newPrice;
        updates.price = newPrice * 3;
      }
    }

    const quoteDocRef = tenantDoc(db, state.subscriberId, 'quotes', quoteId);
    await updateDoc(quoteDocRef, updates);
    showToast('✅ Changes saved', 'success');
    await loadQuotes();
  } catch (error) {
    console.error('Save changes error:', error);
    alert('Failed to save changes: ' + (error.message || 'Unknown error'));
  }
}

function populateBulkBookingCleaner() {
  const sel = document.getElementById('bulkBookingCleaner');
  if (!sel) return;
  sel.innerHTML = '<option value="">Unassigned</option>' + state.cleaners.map(c => `<option value="${c.id}">${escapeHtml(c.name || c.id)}</option>`).join('');
}

async function bookSingleCustomer(quoteId) {
  state.singleBookingId = quoteId;
  populateBulkBookingCleaner();
  document.getElementById('bulkBookingCount').textContent = '1';
  document.getElementById('bulkBookingModal').hidden = false;
}

async function messageSingleCustomer(quoteId) {
  const quote = state.quotes.find(q => q.id === quoteId);
  if (!quote) return;
  const modal = document.getElementById('singleMessageModal');
  document.getElementById('singleMessageCustomer').textContent = escapeHtml(quote.customerName || 'Customer');
  modal.hidden = false;
  state.singleMessageId = quoteId;
}

async function sendSingleMessage() {
  try {
    if (!state.singleMessageId) return;
    const quote = state.quotes.find(q => q.id === state.singleMessageId);
    if (!quote || !quote.email) { alert('No email for this customer'); return; }
    const subject = document.getElementById('singleMessageSubject')?.value?.trim();
    const body = document.getElementById('singleMessageBody')?.value?.trim();
    if (!subject || !body) { alert('Enter subject and message'); return; }
    await window.emailjs.send('service_cdy739m','template_6mpufs4',{
      customer_name: quote.customerName,
      message_body: body,
      email: quote.email
    });
    showToast('✅ Message sent','success');
    document.getElementById('singleMessageModal').hidden = true;
    state.singleMessageId = null;
  } catch (e) {
    console.error(e);
    alert('Failed to send message');
  }
}

async function cancelQuote(quoteId) {
  if (!confirm('Are you sure you want to cancel this quote?')) return;

  try {
    const quoteDoc = tenantDoc(db, state.subscriberId, 'quotes', quoteId);
    await updateDoc(quoteDoc, {
      status: 'Cancelled',
      deleted: true
    });

    showToast('✅ Quote cancelled', 'success');
    await loadQuotes();
  } catch (error) {
    console.error('Cancel quote error:', error);
    alert('Failed to cancel quote: ' + (error.message || 'Unknown error'));
  }
}

function showBulkBookingModal() {
  populateBulkBookingCleaner();
  document.getElementById('bulkBookingCount').textContent = state.selectedIds.size;
  document.getElementById('bulkBookingModal').hidden = false;
  state.singleBookingId = null;
}

function closeBulkBookingModal() {
  document.getElementById('bulkBookingModal').hidden = true;
  state.singleBookingId = null;
}

function closeBulkMessageModal() {
  document.getElementById('bulkMessageModal').hidden = true;
}

async function confirmBulkBooking() {
  try {
    const dateVal = document.getElementById('bulkBookingDate')?.value;
    if (!dateVal) { alert('Select a booking date'); return; }
    const cleaner = document.getElementById('bulkBookingCleaner')?.value || null;
    const booked = new Date(dateVal);
    if (isNaN(booked.getTime())) { alert('Invalid date'); return; }
    const bookedISO = booked.toISOString();
    const nextDates = computeNextCleanDates(bookedISO);

    const targets = state.singleBookingId ? [state.singleBookingId] : [...state.selectedIds];
    let count = 0;
    for (const id of targets) {
      try {
        const ref = tenantDoc(db, state.subscriberId, 'quotes', id);
        await updateDoc(ref, {
          bookedDate: bookedISO,
          nextCleanDates: nextDates,
          status: `Booked - ${formatDate(bookedISO)}`,
          assignedCleaner: cleaner || null
        });
        count++;
      } catch (e) { console.error('Booking failed for', id, e); }
    }
    closeBulkBookingModal();
    showToast(`✅ Booked ${count} customer(s)`,'success');
    state.selectedIds.clear();
    await loadQuotes();
  } catch (e) {
    console.error(e);
    alert('Failed to book customers');
  }
}

async function sendBulkMessages() {
  const subject = document.getElementById('bulkMessageSubject')?.value?.trim();
  const body = document.getElementById('bulkMessageBody')?.value?.trim();
  if (!subject || !body) { alert('Please enter both subject and message'); return; }
  try {
    const selectedQuotes = state.quotes.filter(q => state.selectedIds.has(q.id));
    let successCount = 0;
    for (const quote of selectedQuotes) {
      if (!quote.email) continue;
      try {
        await window.emailjs.send('service_cdy739m','template_6mpufs4',{
          customer_name: quote.customerName,
          message_body: body,
          email: quote.email
        });
        successCount++;
      } catch (emailError) { console.error('Failed to send', quote.email, emailError); }
    }
    closeBulkMessageModal();
    showToast(`✅ Sent ${successCount} message(s)`,'success');
    state.selectedIds.clear();
    updateBulkActionsBar();
    renderTable();
  } catch (error) {
    console.error('Bulk message error:', error);
    alert('Failed to send messages: ' + (error.message || 'Unknown error'));
  }
}

function showBulkMessageModal() {
  document.getElementById('bulkMessageCount').textContent = state.selectedIds.size;
  document.getElementById('bulkMessageModal').hidden = false;
}

function populateTerritorySelectQuote() {
  const sel = document.getElementById('territorySelectQuote');
  if (!sel) return;
  sel.innerHTML = '<option value="">Unassigned</option>' + state.territories.map(t => `<option value="${t.id}">${escapeHtml(t.name || t.id)}</option>`).join('');
}

// Load cleaners for assignment dropdown
async function loadCleaners() {
  try {
    if (!state.subscriberId) return;
    
    const cleanersCol = tenantCollection(db, state.subscriberId, 'cleaners');
    const snapshot = await getDocs(cleanersCol);
    
    state.cleaners = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Load cleaners error:', error);
  }
}

// Load territories for filtering
async function loadTerritories() {
  try {
    if (!state.subscriberId) return;
    
    const territoriesCol = tenantCollection(db, state.subscriberId, 'territories');
    const snapshot = await getDocs(territoriesCol);
    
    state.territories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    refreshFilterValueOptions();
  } catch (error) {
    console.error('Load territories error:', error);
  }
}

// Load custom settings for pricing
async function loadCustomSettings() {
  try {
    if (!state.subscriberId) return;
    
    const settingsDoc = tenantDoc(db, state.subscriberId, 'private', 'addCustomerSettings');
    const snapshot = await getDoc(settingsDoc);
    
    if (snapshot.exists()) {
      state.customSettings = snapshot.data();
      console.log('[Settings] Custom settings loaded', state.customSettings);
    }
  } catch (error) {
    console.error('Load custom settings error:', error);
  }
}

// Export selected customers to CSV
function exportSelectedToCSV() {
  if (state.selectedIds.size === 0) {
    alert('No customers selected');
    return;
  }

  const selectedQuotes = state.quotes.filter(q => state.selectedIds.has(q.id));
  const headers = ['Customer Name', 'Email', 'Mobile', 'Address', 'Status', 'Price/Clean', 'Tier', 'House Size', 'House Type', 'Source', 'Territory', 'Assigned Cleaner', 'Booked Date', 'Latitude', 'Longitude', 'Notes'];
  const rows = selectedQuotes.map(q => [
    q.customerName || '',
    q.email || '',
    q.mobile || '',
    q.address || '',
    q.status || '',
    q.pricePerClean || q.price || '',
    q.tier || '',
    q.houseSize || '',
    q.houseType || '',
    q.repCode || '',
    getTerritoryName(q.territoryId) || '',
    q.assignedCleaner || '',
    q.bookedDate ? formatDate(q.bookedDate) : '',
    q.latitude || '',
    q.longitude || '',
    q.notes || ''
  ]);

  const csv = [headers, ...rows].map(row => 
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"` ).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `selected-customers-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('✅ CSV exported', 'success');
}

// Initialize
async function init() {
  // Initialize header first and wait for it
  await initSubscriberHeader();
  
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
      state.viewerRole = access.viewerRole;
      try {
        localStorage.setItem('swash:lastSubscriberId', state.subscriberId);
      } catch (_) {
        console.warn('Unable to persist subscriberId to localStorage');
      }

      if (access.viewerRole === 'subscriber') {
        if (state.subscriberProfile.disabled) {
          throw new Error('Your account has been disabled. Please contact support.');
        }
        if (!state.subscriberProfile.billingCompleted) {
          window.location.href = './subscriber-billing.html';
          return;
        }
      }

      if (authOverlay) authOverlay.style.display = 'none';
      if (mainContent) mainContent.style.display = 'block';

      // Update header with company name and set active tab
      const companyName = state.subscriberProfile.companyName || 
                         state.subscriberProfile.name || 
                         state.subscriberProfile.email || 
                         'My Business';
      setCompanyName(companyName);
      setActiveTab('quotes');

      // Load data required for the page and AI helper context
      await Promise.all([
        loadCustomSettings(),
        loadCleaners(),
        loadTerritories(),
        loadQuotes()
      ]);

      // Provide AI Helper with subscriber context so API calls include tenant scope
      const cleanerNames = state.cleaners.map(cleaner => cleaner.name || cleaner.displayName || cleaner.id);
      initializeAIHelper(state.subscriberId, companyName, cleanerNames);

      await applyFieldConfiguration();
      attachEventListeners();
      initEmailJS();

    } catch (error) {
      // Distinguish UI errors from real auth errors
      if (error && /textContent/i.test(error.message || '')) {
        console.error('[UI Error] Non-fatal during init:', error);
        showToast('Minor UI issue; continuing without header name', 'error');
        // Attempt to continue loading core data if subscriberId resolved
        if (state.subscriberId) {
          try {
            await Promise.all([
              loadCustomSettings(),
              loadCleaners(),
              loadTerritories(),
              loadQuotes()
            ]);
            await applyFieldConfiguration();
            attachEventListeners();
            initEmailJS();
            if (authOverlay) authOverlay.style.display = 'none';
            if (mainContent) mainContent.style.display = 'block';
            return; // prevent logout
          } catch (secondary) {
            console.error('[Init] Secondary load failed after UI error', secondary);
          }
        }
      }
      console.error('Authentication error:', error);
      alert(error.message || 'Failed to authenticate. Please try logging in again.');
      await signOut(auth);
      window.location.href = '/subscriber-login.html';
    }
  });
}

init();
