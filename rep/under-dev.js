// Under Development Overlay
// Shows a blocking overlay for reps and admins on selected pages.
// Admins get a "Work on this" button to hide it locally.

import { auth, db } from '../firebase-init.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const PAGE_KEY = window.location.pathname; // unique per page
const LS_KEY = `underDevDismissed:${PAGE_KEY}`;

function createOverlay(isAdmin) {
  if (localStorage.getItem(LS_KEY) === "true") return; // already dismissed locally
  const overlay = document.createElement("div");
  overlay.id = "underDevOverlay";
  overlay.className = "under-dev-overlay";
  overlay.innerHTML = `
    <div class="under-dev-card" role="dialog" aria-modal="true" aria-labelledby="ud-title">
      <h2 id="ud-title">This section is under development</h2>
      <p class="under-dev-sub">We're putting the finishing touches on this page. Thanks for your patience.</p>
      <div class="under-dev-actions">
        ${isAdmin ? '<button id="udWorkBtn" class="btn btn-primary">Work on this</button>' : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (isAdmin) {
    const btn = overlay.querySelector('#udWorkBtn');
    btn?.addEventListener('click', () => {
      localStorage.setItem(LS_KEY, 'true');
      overlay.remove();
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  // Always show overlay to authed users; admin gets bypass button
  let isAdmin = false;
  try {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const role = snap.exists() ? snap.data().role : 'none';
      isAdmin = role === 'admin';
    }
  } catch (e) {
    console.warn('[under-dev] role check failed', e);
  } finally {
    createOverlay(isAdmin);
  }
});
