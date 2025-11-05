import {
  query,
  orderBy,
  onSnapshot,
  limit,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMasterLogCollection } from "./log.js";

const logStatus = document.getElementById("logStatus");
const logEntries = document.getElementById("logEntries");
const logEmpty = document.getElementById("logEmpty");

const MASTER_LOG_LIMIT = 200;

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatTimestamp(value) {
  const date = toDate(value);
  if (!date) {
    return "--/--/---- --:--";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function buildEntry({ createdAt, message, user }) {
  const li = document.createElement("li");
  li.className = "log-entry";

  const timestamp = formatTimestamp(createdAt);
  const sourceUser = typeof user === "string" && user.trim() && user !== "System" ? ` — ${user.trim()}` : "";
  const logMessage = String(message ?? "").trim() || "(no message)";

  li.textContent = `[${timestamp}] ${logMessage}${sourceUser}`;

  return li;
}

function renderEntries(snapshot) {
  const fragment = document.createDocumentFragment();
  let renderCount = 0;

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (!data || typeof data.message === "undefined") {
      return;
    }
    fragment.appendChild(buildEntry(data));
    renderCount += 1;
  });

  logEntries.innerHTML = "";
  logEntries.appendChild(fragment);

  const hasEntries = renderCount > 0;
  logEntries.hidden = !hasEntries;
  logEmpty.hidden = hasEntries;
}

function updateStatus(text) {
  if (!logStatus) return;
  logStatus.textContent = text;
}

function initMasterLog() {
  updateStatus("Connecting to Swash master log…");

  const logQuery = query(
    getMasterLogCollection(),
    orderBy("createdAt", "desc"),
    limit(MASTER_LOG_LIMIT),
  );

  const unsubscribe = onSnapshot(
    logQuery,
    (snapshot) => {
      if (snapshot.empty) {
        updateStatus("Waiting for incoming events…");
      } else {
        updateStatus(
          `Live updates active — showing latest ${snapshot.size} event(s).`,
        );
      }

      renderEntries(snapshot);
    },
    (error) => {
      console.error("Failed to load master log", error);
      updateStatus("Unable to load master log. Please refresh to try again.");
    },
  );

  window.addEventListener("beforeunload", () => {
    unsubscribe();
  });
}

initMasterLog();