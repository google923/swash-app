// Shared Firebase initialization for Swash-app
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, indexedDBLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, initializeFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const hostname = typeof window !== "undefined" ? window.location.hostname : "";
// Always use the Firebase-hosted auth domain so the SDK can load /__/auth/iframe
// (Custom domains like app.swashcleaning.co.uk don't serve the auth iframe endpoints.)
const resolvedAuthDomain = "swash-app-436a1.firebaseapp.com";

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
// Improve reliability on some mobile networks/proxies by preferring long polling
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

// Ensure session persistence is set once per app
// Prefer IndexedDB for robust offline persistence; fallback to LocalStorage
setPersistence(auth, indexedDBLocalPersistence)
  .catch(async (err) => {
    console.warn("IndexedDB persistence failed; falling back to LocalStorage", err?.message || err);
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.error("Failed to set Firebase Auth persistence (all strategies)", e);
    }
  });

export { app, auth, db };
