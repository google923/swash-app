// Swash Offline Queue
// Keeps quotes safe when the device is offline and replays them once connectivity resumes.

import {
  initializeApp,
  getApp,
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

const QUEUE_KEY = "swash-offline-queue";

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn("Failed to parse offline queue", error);
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function notifyQueueChange() {
  try {
    const detail = { queue: loadQueue() };
    window.dispatchEvent(new CustomEvent("swashQueueUpdated", { detail }));
  } catch (error) {
    console.warn("Failed to notify queue change", error);
  }
}

export function queueOfflineSubmission(data) {
  const queue = loadQueue();
  queue.push({
    ...data,
    queuedAt: new Date().toISOString(),
    emailPending: data.emailPending !== false,
  });
  saveQueue(queue);
  notifyQueueChange();
  console.info(
    "Queued offline submission",
    data.customerName || data.refCode || "Unknown customer",
  );

  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "QUEUE_QUOTE",
      payload: data,
    });
  }
}

export async function syncQueue() {
  const queue = loadQueue();
  if (!queue.length) return;

  console.info(`Syncing ${queue.length} queued quote(s)…`);
  const remaining = [];

  for (const quote of queue) {
    try {
      const { emailPending, queuedAt, ...quoteData } = quote;
      await addDoc(collection(db, "quotes"), {
        ...quoteData,
        createdAt: quote.createdAt || serverTimestamp(),
        syncedAt: serverTimestamp(),
      });
      console.info(
        "Synced queued quote",
        quote.customerName || quote.refCode || "Unknown customer",
      );
      if (typeof window !== "undefined" && quote.emailPending !== false) {
        window.dispatchEvent(
          new CustomEvent("swashQueueSynced", { detail: { quote } }),
        );
      }
    } catch (error) {
      console.error(
        "Failed to sync queued quote",
        quote.refCode || quote.customerName,
        error,
      );
      remaining.push(quote);
    }
  }

  saveQueue(remaining);
  notifyQueueChange();
  if (!remaining.length) {
    console.info("All queued quotes synced.");
  } else {
    console.warn(`${remaining.length} queued quote(s) still pending sync.`);
  }
}

window.addEventListener("online", async () => {
  await syncQueue();
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register("sync-quotes");
      console.info("Background sync registered (sync-quotes).");
    } catch (error) {
      console.warn("Background sync registration failed", error);
    }
  }

  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "ONLINE" });
  }
});

window.addEventListener("offline", () => {
  console.warn("Offline mode activated. Quotes will be queued until reconnected.");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SYNC_OFFLINE_QUOTES") {
      syncQueue();
    }
  });
}

export function getQueue() {
  return loadQueue();
}

export function removeFromQueue(refCode) {
  const filtered = loadQueue().filter((item) => item.refCode !== refCode);
  saveQueue(filtered);
  notifyQueueChange();
}

export default { queueOfflineSubmission, syncQueue, getQueue, removeFromQueue };
