// Login page handler
import { auth } from '../firebase-init.js';
import { authStateReady, handlePageRouting } from '../auth-check.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const els = {
  form: document.getElementById("loginForm"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  submitBtn: document.getElementById("submitBtn"),
  errorMessage: document.getElementById("errorMessage"),
  loadingMessage: document.getElementById("loadingMessage"),
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function initLoginPage() {
  if (!els.form) return;

  await authStateReady();
  console.log("[Page] Auth ready, userRole:", window.userRole);
  const routing = await handlePageRouting("login");
  if (routing.redirected) return;

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();

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
      await signInWithEmailAndPassword(auth, email, password);
      // Give auth state and user doc time to load before routing
      await delay(800);
      const result = await handlePageRouting("login");
      if (!result.redirected) {
        // Retry once more in case user doc was still loading
        await delay(700);
        const retry = await handlePageRouting("login");
        if (!retry.redirected) {
          // Still no redirect - legitimate access level issue
          els.submitBtn.disabled = false;
          els.loadingMessage.classList.remove("show");
          showError("Unable to determine your access level. Please contact administrator.");
        }
      }
      // If redirected, keep loading message visible during navigation
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
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorMessage.classList.add("show");
}

initLoginPage();
