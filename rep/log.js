// Shared logging helper for Swash tools
// Provides a simple API to push events into the master_log collection.

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};

const MASTER_LOG_COLLECTION = "master_log";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const logCollectionRef = collection(db, MASTER_LOG_COLLECTION);

/**
 * Records a new event into the shared master log.
 * @param {string} message - Human readable event description.
 * @param {string} [user="System"] - Source user or subsystem name.
 * @returns {Promise<void>}
 */
export async function logEvent(message, user = "System") {
  const trimmedMessage = String(message ?? "").trim();
  if (!trimmedMessage) {
    throw new Error("logEvent requires a non-empty message.");
  }

  await addDoc(logCollectionRef, {
    message: trimmedMessage,
    user: user?.trim() || "System",
    createdAt: serverTimestamp(),
  });
}

export function getMasterLogCollection() {
  return logCollectionRef;
}

export { db };