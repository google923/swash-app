const getRawBody = require("raw-body");

let cachedAdmin = null;
let cachedFirestore = null;

const JOBS_COLLECTION = "jobs";
const SWASH_OUTBOUND_ADDRESS = "contact@swashcleaning.co.uk";
let outboundLoggerModulePromise = null;

function normalizeJobDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

async function syncEmailToCustomerJob({ db, adminSdk, customerId, messageRef, messageTimestamp }) {
  try {
    if (!customerId || !messageRef) {
      return;
    }

    const referenceDate = messageTimestamp instanceof adminSdk.firestore.Timestamp
      ? messageTimestamp.toDate()
      : normalizeJobDate(messageTimestamp) || new Date();

    const jobsRef = db.collection(JOBS_COLLECTION);
    const snapshot = await jobsRef
      .where("customerId", "==", customerId)
      .orderBy("date")
      .limit(25)
      .get();

    if (snapshot.empty) {
      console.log("[ZohoWebhook] No jobs found for customer", customerId);
      return;
    }

    let nearestUpcoming = null;
    let latestPast = null;
    snapshot.forEach((docSnap) => {
      const jobData = docSnap.data() || {};
      const rawDate = jobData.date || jobData.jobDate || jobData.scheduledDate;
      const jobDate = normalizeJobDate(rawDate);
      if (!jobDate) {
        return;
      }
      const diff = jobDate.getTime() - referenceDate.getTime();
      if (diff >= 0) {
        if (!nearestUpcoming || diff < nearestUpcoming.diff) {
          nearestUpcoming = {
            diff,
            docId: docSnap.id,
            dateValue: rawDate,
            status: jobData.status || null,
          };
        }
      } else if (!latestPast || diff > latestPast.diff) {
        latestPast = {
          diff,
          docId: docSnap.id,
          dateValue: rawDate,
          status: jobData.status || null,
        };
      }
    });

    const match = nearestUpcoming || latestPast;
    if (!match) {
      console.log("[ZohoWebhook] Jobs exist for customer but none have a valid date", customerId);
      return;
    }

    await messageRef.update({
      jobId: match.docId,
      jobDate: match.dateValue || null,
      jobStatus: match.status || null,
    });

    console.log(
      `[ZohoWebhook] Linked message ${messageRef.id} to job ${match.docId} (date: ${match.dateValue || "unknown"})`,
    );
  } catch (error) {
    console.error("[ZohoWebhook] Failed to sync message to job", {
      customerId,
      messageId: messageRef?.id,
      error: error?.message,
    });
  }
}

function initFirebaseAdmin() {
  if (cachedAdmin && cachedFirestore) {
    return { admin: cachedAdmin, firestore: cachedFirestore };
  }

  try {
    cachedAdmin = require("firebase-admin");
  } catch (error) {
    console.error("[ZohoWebhook] firebase-admin dependency missing", error);
    throw new Error("firebase-admin not installed");
  }

  if (!cachedAdmin.apps.length) {
    const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null;

    if (credentialJson) {
      cachedAdmin.initializeApp({
        credential: cachedAdmin.credential.cert(credentialJson),
      });
      console.log("[ZohoWebhook] Firebase Admin initialised via FIREBASE_SERVICE_ACCOUNT credential");
    } else {
      cachedAdmin.initializeApp({
        credential: cachedAdmin.credential.applicationDefault(),
      });
      console.log("[ZohoWebhook] Firebase Admin initialised via application default credential");
    }
  }

  cachedFirestore = cachedAdmin.firestore();
  return { admin: cachedAdmin, firestore: cachedFirestore };
}

function extractEmail(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return extractEmail(value[0]);
  }
  if (typeof value === "object") {
    if (value.email) return String(value.email).trim();
    if (value.address) return String(value.address).trim();
    if (value.value) return String(value.value).trim();
  }
  return "";
}

function normalizeRecipients(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractEmail(entry) || String(entry || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const segments = [];
    if (value.to) segments.push(normalizeRecipients(value.to));
    if (value.cc) segments.push(normalizeRecipients(value.cc));
    if (value.bcc) segments.push(normalizeRecipients(value.bcc));
    return segments.filter(Boolean).join(", ");
  }
  return "";
}

function extractRecipientEmails(value) {
  const emails = new Set();
  if (!value) return [];
  if (typeof value === "string") {
    const candidates = value.split(/[;,]/g).map((segment) => extractEmail(segment) || segment.trim());
    candidates.filter(Boolean).forEach((email) => emails.add(email));
  } else if (Array.isArray(value)) {
    value.forEach((entry) => {
      const email = extractEmail(entry);
      if (email) emails.add(email);
    });
  } else if (typeof value === "object") {
    if (value.to) extractRecipientEmails(value.to).forEach((email) => emails.add(email));
    if (value.cc) extractRecipientEmails(value.cc).forEach((email) => emails.add(email));
    if (value.bcc) extractRecipientEmails(value.bcc).forEach((email) => emails.add(email));
  } else {
    const fallback = extractEmail(value);
    if (fallback) emails.add(fallback);
  }
  return Array.from(emails);
}

async function logOutboundViaHelper(payload) {
  if (!outboundLoggerModulePromise) {
    outboundLoggerModulePromise = import("../lib/firestore-utils.js");
  }
  const module = await outboundLoggerModulePromise;
  if (!module || typeof module.logOutboundEmailToFirestore !== "function") {
    throw new Error("logOutboundEmailToFirestore helper unavailable");
  }
  return module.logOutboundEmailToFirestore(payload);
}

function extractTextField(...inputs) {
  for (const candidate of inputs) {
    if (!candidate) continue;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "";
}

async function findCustomerByEmail(db, email) {
  const trimmed = email.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  const customersRef = db.collection("customers");

  const lowerSnap = await customersRef.where("emailLower", "==", normalized).limit(1).get();
  if (!lowerSnap.empty) {
    return lowerSnap.docs[0];
  }

  const directSnap = await customersRef.where("email", "==", trimmed).limit(1).get();
  if (!directSnap.empty) {
    return directSnap.docs[0];
  }

  return null;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-zoho-mail-webhook-signature");

  if (req.method === "OPTIONS") {
    console.log("[ZohoWebhook] OPTIONS preflight acknowledged");
    return res.status(200).end();
  }

  if (req.method === "GET") {
    console.log("[ZohoWebhook] Received GET verification ping");
    return res.status(200).json({ success: true, message: "Test GET OK" });
  }

  if (req.method !== "POST") {
    console.warn(`[ZohoWebhook] Unsupported HTTP method: ${req.method}`);
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  let rawBody;
  try {
    const buffer = await getRawBody(req);
    rawBody = buffer.toString("utf8");
  } catch (error) {
    console.error("[ZohoWebhook] Failed to read request body", error);
    return res.status(500).json({ success: false, message: "Unable to read request body" });
  }

  console.log("[ZohoWebhook] Raw POST payload:", rawBody);

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    console.error("[ZohoWebhook] Failed to parse JSON payload", error);
    return res.status(400).json({ success: false, message: "Invalid JSON payload" });
  }

  const fromAddress = extractEmail(
    payload.fromAddress ?? payload.from ?? payload.sender ?? payload.mailFrom ?? payload.envelope?.from,
  );
  const toAddress = normalizeRecipients(
    payload.toAddress ?? payload.to ?? payload.recipients ?? payload.mailTo ?? payload.envelope?.to,
  );
  const recipientEmails = extractRecipientEmails(
    payload.toAddress ?? payload.to ?? payload.recipients ?? payload.mailTo ?? payload.envelope?.to,
  );
  const subject = extractTextField(
    payload.subject,
    payload.mailSubject,
    payload.messageSubject,
    payload.topic,
    payload.summary,
  );
  const body = extractTextField(
    payload.body,
    payload.text,
    payload.plainTextContent,
    payload.content,
    payload.html,
    payload.message,
  );

  const receivedTimeCandidate =
    payload.receivedTime ??
    payload.timestamp ??
    payload.eventTime ??
    payload.Received_Time ??
    payload.mailReceivedTime ??
    Date.now();

  let receivedDate = new Date(receivedTimeCandidate);
  if (Number.isNaN(receivedDate.getTime())) {
    console.warn("[ZohoWebhook] Invalid receivedTime, defaulting to now", receivedTimeCandidate);
    receivedDate = new Date();
  }

  console.log("[ZohoWebhook] Parsed fields", {
    fromAddress,
    toAddress,
    subjectPreview: subject ? subject.slice(0, 120) : "",
    bodyPreview: body ? body.slice(0, 120) : "",
    receivedAt: receivedDate.toISOString(),
  });

  if (!fromAddress) {
    console.warn("[ZohoWebhook] Missing `from` address in payload");
    return res.status(200).json({ success: true, message: "Email processed OK" });
  }

  const isOutboundFromSwash = fromAddress.trim().toLowerCase() === SWASH_OUTBOUND_ADDRESS;
  if (isOutboundFromSwash) {
    if (!recipientEmails.length) {
      console.warn("[ZohoWebhook] Outbound email missing recipient list", payload);
    } else {
      for (const recipient of recipientEmails) {
        try {
          await logOutboundViaHelper({
            to: recipient,
            subject,
            body,
            source: "zoho-outbound",
          });
          console.log(`[ZohoWebhook] Logged outbound email to ${recipient}`);
        } catch (error) {
          console.error("[ZohoWebhook] Failed to log outbound email", {
            recipient,
            error: error?.message,
          });
        }
      }
    }
    return res.status(200).json({ success: true, message: "Outbound email processed" });
  }

  let adminSdk;
  let db;
  try {
    const refs = initFirebaseAdmin();
    adminSdk = refs.admin;
    db = refs.firestore;
  } catch (error) {
    console.error("[ZohoWebhook] Firebase Admin initialisation failed", error);
    return res.status(500).json({ success: false, message: "Firebase Admin not configured" });
  }

  let customerSnapshot;
  try {
    console.log(`[ZohoWebhook] Looking up customer by email: ${fromAddress}`);
    customerSnapshot = await findCustomerByEmail(db, fromAddress);
  } catch (error) {
    console.error("[ZohoWebhook] Firestore lookup error", error);
    return res.status(500).json({ success: false, message: "Firestore lookup failed" });
  }

  if (!customerSnapshot) {
    console.warn(`[ZohoWebhook] No customer record found for ${fromAddress}. Message logged but not stored.`);
    return res.status(200).json({ success: true, message: "Email processed OK" });
  }

  console.log(`[ZohoWebhook] Customer located: ${customerSnapshot.id}`);

  const messageTimestamp = adminSdk.firestore.Timestamp.fromDate(receivedDate);
  const messageData = {
    direction: "inbound",
    type: "email",
    channel: "email",
    source: "zoho-webhook",
    from: fromAddress,
    to: toAddress,
    subject,
    body,
    preview: body ? body.slice(0, 240) : subject.slice(0, 240),
    timestamp: messageTimestamp,
    storedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
    createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
    jobId: null,
    jobDate: null,
    jobStatus: null,
    rawPayload: payload,
    read: false,
  };

  try {
    const messageRef = await customerSnapshot.ref.collection("messages").add(messageData);
    console.log(
      `[ZohoWebhook] Stored inbound message ${messageRef.id} under customers/${customerSnapshot.id}/messages`,
    );
    
    try {
      await customerSnapshot.ref.update({
        "counters.unreadCount": adminSdk.firestore.FieldValue.increment(1),
      });
      console.log(`[ZohoWebhook] Incremented unread counter for customer ${customerSnapshot.id}`);
    } catch (counterError) {
      console.warn("[ZohoWebhook] Failed to update unread counter", {
        customerId: customerSnapshot.id,
        error: counterError?.message,
      });
    }

    await syncEmailToCustomerJob({
      db,
      adminSdk,
      customerId: customerSnapshot.id,
      messageRef,
      messageTimestamp,
    });
  } catch (error) {
    console.error("[ZohoWebhook] Failed to persist message document", error);
    return res.status(500).json({ success: false, message: "Failed to persist message" });
  }

  return res.status(200).json({ success: true, message: "Email processed OK" });
}
