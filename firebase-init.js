// Shared Firebase initialization for Swash-app
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const hostname = typeof window !== "undefined" ? window.location.hostname : "";
const useFirebaseHostedDomain = hostname.includes("vercel.app");
const resolvedAuthDomain = useFirebaseHostedDomain ? "swash-app-436a1.firebaseapp.com" : "app.swashcleaning.co.uk";

const firebaseConfig = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: resolvedAuthDomain,
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};

console.log(`[Firebase] Initialising app for host "${hostname || "server"}" using authDomain "${firebaseConfig.authDomain}"`);

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Ensure session persistence is set once per app
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Failed to set Firebase Auth persistence", err);
});

export { app, auth, db };
