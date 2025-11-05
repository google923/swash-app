// Login page handler
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const els = {
  form: document.getElementById("loginForm"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  submitBtn: document.getElementById("submitBtn"),
  errorMessage: document.getElementById("errorMessage"),
  loadingMessage: document.getElementById("loadingMessage"),
};

// Check if user is already logged in
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const role = snap.data().role || "rep";
        // Redirect to appropriate dashboard
        if (role === "admin") {
          window.location.href = "./admin.html";
        } else if (role === "rep") {
          window.location.href = "./rep-home.html";
        }
      }
    } catch (err) {
      console.error("Failed to check user role", err);
    }
  }
});

// Handle login form submission
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = els.email.value.trim();
  const password = els.password.value;

  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
  }

  els.submitBtn.disabled = true;
  els.loadingMessage.classList.add("show");
  els.errorMessage.classList.remove("show");

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Get user role
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "rep";

    // Redirect based on role
    if (role === "admin") {
      window.location.href = "./admin.html";
    } else if (role === "rep") {
      window.location.href = "./rep-home.html";
    } else {
      showError("Your account does not have a valid role. Please contact administrator.");
      els.submitBtn.disabled = false;
      els.loadingMessage.classList.remove("show");
    }
  } catch (error) {
    els.submitBtn.disabled = false;
    els.loadingMessage.classList.remove("show");

    let message = "Failed to sign in. Please try again.";

    if (error.code === "auth/user-not-found") {
      message = "Email address not found.";
    } else if (error.code === "auth/wrong-password") {
      message = "Incorrect password.";
    } else if (error.code === "auth/invalid-email") {
      message = "Invalid email address.";
    } else if (error.code === "auth/user-disabled") {
      message = "This account has been disabled.";
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many failed login attempts. Please try again later.";
    }

    showError(message);
    console.error("Login error:", error);
  }
});

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorMessage.classList.add("show");
}
