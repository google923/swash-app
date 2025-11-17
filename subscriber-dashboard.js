import { auth, db } from './firebase-init.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// State
const state = {
  currentUser: null,
  subscriberId: null,
  userData: null,
  stats: {
    quotes: 0,
    customers: 0,
    pending: 0,
    revenue: 0
  }
};

// DOM elements
const authOverlay = document.getElementById('authOverlay');
const dashboardContent = document.getElementById('dashboardContent');
const logoutBtn = document.getElementById('logoutBtn');
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');
const companyNameDisplay = document.getElementById('companyNameDisplay');

// Initialize
async function init() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Not logged in - redirect to subscriber login page
      console.log('[Subscriber Dashboard] No user detected, redirecting to subscriber login');
      window.location.href = './subscriber-login.html';
      return;
    }

    try {
      state.currentUser = user;
      console.log('[Subscriber Dashboard] User detected:', user.email);

      // Check if viewing someone else's dashboard (admin feature)
      const urlParams = new URLSearchParams(window.location.search);
      const viewingUid = urlParams.get('uid');

      // Get current user's document
      const currentUserDoc = await getDoc(doc(db, 'users', user.uid));

      if (!currentUserDoc.exists()) {
        console.error('[Subscriber Dashboard] User document not found for:', user.uid);
        throw new Error('User document not found');
      }

      const currentUserData = currentUserDoc.data();
      console.log('[Subscriber Dashboard] User data loaded. Role:', currentUserData.role);

      // If admin is viewing another subscriber's dashboard
      if (viewingUid && currentUserData.role === 'admin') {
        state.subscriberId = viewingUid;
        
        // Get the subscriber's data
        const subscriberDoc = await getDoc(doc(db, 'users', viewingUid));
        
        if (!subscriberDoc.exists()) {
          throw new Error('Subscriber not found');
        }

        state.userData = subscriberDoc.data();

        if (state.userData.role !== 'subscriber') {
          throw new Error('The specified user is not a subscriber');
        }

      } else {
        // Regular subscriber viewing their own dashboard
        state.subscriberId = user.uid;
        state.userData = currentUserData;

        // Check role
        if (state.userData.role !== 'subscriber') {
          throw new Error('Access denied. This dashboard is for subscribers only.');
        }

        // Check if disabled
        if (state.userData.disabled) {
          throw new Error('Your account has been disabled. Please contact support.');
        }

        // Check if billing is completed
        if (!state.userData.billingCompleted) {
          // Redirect to billing page
          window.location.href = './subscriber-billing.html';
          return;
        }
      }

      // Show dashboard
      authOverlay.style.display = 'none';
      dashboardContent.style.display = 'block';

      // Display company name
      if (state.userData.companyName) {
        companyNameDisplay.textContent = state.userData.companyName;
      }

      // Load dashboard data
      await loadDashboardData();

    } catch (error) {
      console.error('Authentication error:', error);
      alert(error.message || 'Failed to authenticate. Please try logging in again.');
      await signOut(auth);
      window.location.href = './subscriber-login.html';
    }
  });

  // Logout button
  logoutBtn.addEventListener('click', async () => {
    try {
      await signOut(auth);
      window.location.href = './subscriber-login.html';
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to sign out');
    }
  });

  // Menu dropdown toggle
  menuBtn.addEventListener('click', () => {
    const isExpanded = menuDropdown.classList.toggle('show');
    menuBtn.setAttribute('aria-expanded', isExpanded);
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-box')) {
      menuDropdown.classList.remove('show');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// Load dashboard statistics and recent activity
async function loadDashboardData() {
  try {
    await Promise.all([
      loadStats(),
      loadRecentActivity()
    ]);
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

// Load statistics
async function loadStats() {
  try {
    const subscriberPath = `subscribers/${state.subscriberId}`;

    // Count quotes
    const quotesSnapshot = await getDocs(
      collection(db, subscriberPath, 'quotes')
    );
    state.stats.quotes = quotesSnapshot.size;

    // Count customers
    const customersSnapshot = await getDocs(
      collection(db, subscriberPath, 'customers')
    );
    state.stats.customers = customersSnapshot.size;

    // Count pending (quotes with status containing "Pending")
    let pendingCount = 0;
    let totalRevenue = 0;

    quotesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status && data.status.toLowerCase().includes('pending')) {
        pendingCount++;
      }
      // Calculate revenue for this month
      if (data.bookedDate) {
        const bookedDate = new Date(data.bookedDate);
        const now = new Date();
        if (bookedDate.getMonth() === now.getMonth() && 
            bookedDate.getFullYear() === now.getFullYear()) {
          totalRevenue += parseFloat(data.price || 0);
        }
      }
    });

    state.stats.pending = pendingCount;
    state.stats.revenue = totalRevenue;

    // Update UI
    document.getElementById('statQuotes').textContent = state.stats.quotes;
    document.getElementById('statCustomers').textContent = state.stats.customers;
    document.getElementById('statPending').textContent = state.stats.pending;
    document.getElementById('statRevenue').textContent = `£${state.stats.revenue.toFixed(2)}`;

  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load recent activity
async function loadRecentActivity() {
  try {
    const subscriberPath = `subscribers/${state.subscriberId}`;
    const recentActivityDiv = document.getElementById('recentActivity');

    // Get recent quotes (last 5)
    const quotesSnapshot = await getDocs(
      query(
        collection(db, subscriberPath, 'quotes'),
        orderBy('createdAt', 'desc'),
        limit(5)
      )
    );

    if (quotesSnapshot.empty) {
      recentActivityDiv.innerHTML = '<p style="color:#64748b;text-align:center;">No recent activity</p>';
      return;
    }

    const activities = [];
    quotesSnapshot.forEach((doc) => {
      const data = doc.data();
      activities.push({
        type: 'quote',
        customer: data.customerName || 'Unknown',
        status: data.status || 'Unknown',
        date: data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString() : 'Unknown',
        price: data.price || 0
      });
    });

    recentActivityDiv.innerHTML = activities.map(activity => `
      <div style="padding:12px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;color:#1e293b;">New Quote: ${escapeHtml(activity.customer)}</div>
          <div style="font-size:14px;color:#64748b;margin-top:4px;">
            ${escapeHtml(activity.status)} • ${activity.date}
          </div>
        </div>
        <div style="font-weight:600;color:#0078d7;">£${activity.price.toFixed(2)}</div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error loading recent activity:', error);
    document.getElementById('recentActivity').innerHTML = 
      '<p style="color:#dc2626;text-align:center;">Failed to load recent activity</p>';
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start the app
init();
