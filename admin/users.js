import { auth, db } from '../firebase-init.js';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// State
const state = {
  currentUser: null,
  isAdmin: false,
  users: [],
};

// DOM elements
const addUserForm = document.getElementById("addUserForm");
const editUserForm = document.getElementById("editUserForm");
const editModal = document.getElementById("editModal");
const cancelEditBtn = document.getElementById("cancelEdit");
const refreshBtn = document.getElementById("refreshBtn");
const usersContainer = document.getElementById("usersContainer");

// Initialize
async function init() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.currentUser = user;
      await checkAdminStatus();
      await loadUsers();
    }
  });

  addUserForm.addEventListener("submit", handleAddUser);
  editUserForm.addEventListener("submit", handleEditUser);
  cancelEditBtn.addEventListener("click", closeEditModal);
  refreshBtn.addEventListener("click", loadUsers);

  // Close modal on outside click
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) {
      closeEditModal();
    }
  });
}

// Check if current user is admin
async function checkAdminStatus() {
  try {
    const userDocRef = doc(db, "users", state.currentUser.uid);
    const userDoc = await getDocs(query(collection(db, "users")));
    const currentUserDoc = userDoc.docs.find(
      (doc) => doc.id === state.currentUser.uid
    );
    if (currentUserDoc) {
      const userData = currentUserDoc.data();
      state.isAdmin = userData.role === "admin";
    }
  } catch (err) {
    console.error("Error checking admin status:", err);
  }
}

// Load all users from Firestore
async function loadUsers() {
  try {
    usersContainer.innerHTML =
      '<p style="color: #64748b; text-align: center; padding: 40px;">Loading users...</p>';

    const usersQuery = query(collection(db, "users"), orderBy("name"));
    const snapshot = await getDocs(usersQuery);

    state.users = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    renderUsers();
  } catch (err) {
    console.error("Error loading users:", err);
    usersContainer.innerHTML = `<p style="color: #dc2626; text-align: center; padding: 40px;">Error loading users: ${err.message}</p>`;
  }
}

// Render users as cards
function renderUsers() {
  const allowedRoles = new Set(["rep", "cleaner"]);
  const visibleUsers = state.users.filter((user) =>
    allowedRoles.has((user.role || "rep").toLowerCase())
  );

  if (visibleUsers.length === 0) {
    usersContainer.innerHTML =
      '<p style="color: #64748b; text-align: center; padding: 40px;">No reps or cleaners found.</p>';
    return;
  }

  usersContainer.innerHTML = visibleUsers
    .map((user) => {
      const roleKey = (user.role || "rep").toLowerCase();
      const roleClass = ["rep", "cleaner"].includes(roleKey) ? roleKey : "rep";
      const roleLabelMap = { rep: "REP", cleaner: "CLEANER" };
      const roleLabel = roleLabelMap[roleClass] || roleClass.toUpperCase();
      const isRepLike = roleClass === "rep" || roleClass === "cleaner";
      return `
      <div class="user-card">
        <div class="user-card__header">
          <div class="user-card__name">${escapeHtml(user.name || "Unknown")}</div>
          <div class="user-card__header-right">
            <div class="user-card__role user-card__role--${roleClass}">${roleLabel}</div>
            <button class="icon-btn" title="Delete ${escapeHtml(
              user.name || "user"
            )}" aria-label="Delete ${escapeHtml(user.name || "user")}" onclick="window.deleteUser(${JSON.stringify(
              user.id
            )}, ${JSON.stringify(user.name || "this user")})">&times;</button>
          </div>
        </div>
        <div class="user-card__info">📧 ${escapeHtml(user.email || "No email")}</div>
        <div class="user-card__info">🆔 ${escapeHtml(user.id)}</div>
        <div class="user-card__disabled">
          <label class="training-toggle">
            <input type="checkbox" ${user.disabled ? 'checked' : ''} onchange="window.toggleDisabled('${user.id}', this.checked)" />
            <span class="training-slider"></span>
          </label>
          <span>Disable User</span>
          ${user.disabled ? '<span class="disabled-badge">Disabled</span>' : ''}
        </div>
        ${isRepLike ? `
        <div class="user-card__training">
          <label class="training-toggle">
            <input type="checkbox" ${user.training ? 'checked' : ''} onchange="window.toggleTraining('${user.id}', this.checked)" />
            <span class="training-slider"></span>
          </label>
          <span>Training Mode</span>
          ${user.training ? '<span class="training-badge">In Training</span>' : ''}
        </div>
        <div class="user-card__contract-type">
          <label for="contractType_${user.id}">Contract Type:</label>
          <select id="contractType_${user.id}" onchange="window.updateContractType('${user.id}', this.value)">
            <option value="freelance" ${user.contractType === 'freelance' ? 'selected' : ''}>Freelance</option>
            <option value="paye" ${user.contractType === 'paye' ? 'selected' : ''}>PAYE</option>
            <option value="commission" ${user.contractType === 'commission' ? 'selected' : ''}>Commission-Only</option>
          </select>
        </div>
        ` : ''}
        <div class="user-card__actions" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
          <button class="btn btn-secondary" onclick="window.editUser('${user.id}')">Edit</button>
          ${isRepLike ? `<a class="btn btn-primary" href="/rep/contract.html?uid=${user.id}" target="_blank" rel="noopener">Contract</a>` : ''}
        </div>
      </div>`;
    })
    .join("");
}

// Handle add user form submission
async function handleAddUser(e) {
  e.preventDefault();

  const email = document.getElementById("newEmail").value.trim();
  const password = document.getElementById("newPassword").value;
  const name = document.getElementById("newName").value.trim();
  const companyName = document.getElementById("newCompanyName").value.trim();
  const role = document.getElementById("newRole").value;

  if (!email || !password || !name || !role) {
    alert("Please fill in all required fields.");
    return;
  }

  if (password.length < 6) {
    alert("Password must be at least 6 characters.");
    return;
  }

  try {
    // Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const newUser = userCredential.user;

    // Store user metadata in Firestore
    const userData = {
      email: email,
      name: name,
      repName: name,
      role: role,
      createdAt: new Date().toISOString(),
    };
    
    if (companyName && role === 'subscriber') {
      userData.companyName = companyName;
    }
    
    await setDoc(doc(db, "users", newUser.uid), userData);

    alert(`User "${name}" created successfully!`);

    // Reset form and reload users
    addUserForm.reset();
    await loadUsers();

    // Sign back in as admin (creating a user signs you in as that user)
    // User will need to refresh or we handle this gracefully
    window.location.reload();
  } catch (err) {
    console.error("Error creating user:", err);
    alert(`Error creating user: ${err.message}`);
  }
}

// Open edit modal
window.editUser = function (userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return;

  document.getElementById("editUserId").value = user.id;
  document.getElementById("editName").value = user.name || "";
  document.getElementById("editEmail").value = user.email || "";
  document.getElementById("editRole").value = user.role || "rep";

  editModal.removeAttribute("hidden");
};

// Close edit modal
function closeEditModal() {
  editModal.setAttribute("hidden", "");
  editUserForm.reset();
}

// Handle edit user form submission
async function handleEditUser(e) {
  e.preventDefault();

  const userId = document.getElementById("editUserId").value;
  const name = document.getElementById("editName").value.trim();
  const role = document.getElementById("editRole").value;

  if (!name || !role) {
    alert("Please fill in all required fields.");
    return;
  }

  try {
    await updateDoc(doc(db, "users", userId), {
      name: name,
      repName: name,
      role: role,
    });

    alert("User updated successfully!");
    closeEditModal();
    await loadUsers();
  } catch (err) {
    console.error("Error updating user:", err);
    alert(`Error updating user: ${err.message}`);
  }
}

// Delete user
window.deleteUser = async function (userId, userName) {
  const confirmed = confirm(
    `Are you sure you want to delete "${userName}"?\n\nThis will remove their Firestore user data but NOT their Firebase Auth account. They will still be able to log in but will have no role/name data.`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "users", userId));
    alert(`User "${userName}" deleted from Firestore.`);
    await loadUsers();
  } catch (err) {
    console.error("Error deleting user:", err);
    alert(`Error deleting user: ${err.message}`);
  }
};

// Toggle disabled status for a user
window.toggleDisabled = async function (userId, isDisabled) {
  try {
    await updateDoc(doc(db, "users", userId), {
      disabled: isDisabled,
    });
    console.log(`User ${isDisabled ? 'disabled' : 'enabled'}: ${userId}`);
    await loadUsers();
  } catch (err) {
    console.error("Error toggling disabled status:", err);
    alert(`Error updating disabled status: ${err.message}`);
    await loadUsers(); // Reload to reset toggle state
  }
};

// Toggle training mode for a rep
window.toggleTraining = async function (userId, isTraining) {
  try {
    await updateDoc(doc(db, "users", userId), {
      training: isTraining,
    });
    console.log(`Training mode ${isTraining ? 'enabled' : 'disabled'} for user ${userId}`);
    await loadUsers();
  } catch (err) {
    console.error("Error toggling training mode:", err);
    alert(`Error updating training mode: ${err.message}`);
    await loadUsers(); // Reload to reset toggle state
  }
};

// Update contract type for a rep
window.updateContractType = async function (userId, contractType) {
  try {
    await updateDoc(doc(db, "users", userId), {
      contractType: contractType,
    });
    console.log(`Contract type set to ${contractType} for user ${userId}`);
    // Don't reload to avoid dropdown flickering
  } catch (err) {
    console.error("Error updating contract type:", err);
    alert(`Error updating contract type: ${err.message}`);
    await loadUsers(); // Reload to reset dropdown state
  }
};

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Start the app
init();
