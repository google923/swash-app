import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  limit,
  limitToLast,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc,
  increment,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { logOutboundEmailToFirestore } from "../../lib/firestore-utils.js";

const CLEANER_LABEL_OVERRIDES = {
  "Cleaner 1": "Chris",
};

function getCleanerLabel(value) {
  if (!value) return value;
  return CLEANER_LABEL_OVERRIDES[value] || value;
}

function normalizeCustomerIdValue(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes("/")) {
      const parts = trimmed.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    }
    return trimmed;
  }
  if (typeof value === "object") {
    if (typeof value.id === "string" && value.id) {
      return value.id;
    }
    if (typeof value.path === "string" && value.path) {
      const parts = value.path.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    }
  }
  return null;
}

function getCustomerEmailKey(quote) {
  const email = (quote?.email || quote?.customerEmail || "").trim().toLowerCase();
  return email || null;
}

function extractInlineCustomerId(quote) {
  if (!quote) return null;
  const candidates = [
    quote.customerId,
    quote.customerDocId,
    quote.customerDocumentId,
    quote.customerRecordId,
    quote.customerRefId,
    quote.customerUid,
    quote.customerRef,
    quote.customerDocRef,
    quote.customerDocPath,
    quote.customerPath,
  ];
  for (const candidate of candidates) {
    const resolved = normalizeCustomerIdValue(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function firstNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
}

function combineParts(...parts) {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

function extractCustomerBasics(quote = {}, jobCard = null) {
  const dataset = jobCard?.dataset || {};

  const email = firstNonEmptyString(
    dataset.email,
    dataset.customerEmail,
    quote.email,
    quote.customerEmail,
    quote.contactEmail,
    quote?.customer?.email,
  );

  const firstName = firstNonEmptyString(
    dataset.firstName,
    dataset.customerFirstName,
    quote.firstName,
    quote.customerFirstName,
  );
  const lastName = firstNonEmptyString(
    dataset.lastName,
    dataset.customerLastName,
    quote.lastName,
    quote.customerLastName,
  );
  const nameFromParts = [firstName, lastName].filter(Boolean).join(" ") || null;

  const name =
    firstNonEmptyString(
      dataset.customerName,
      dataset.name,
      quote.customerName,
      quote.name,
      nameFromParts,
    ) || "Customer";

  const compositeAddress = combineParts(
    firstNonEmptyString(dataset.addressLine1, quote.addressLine1),
    firstNonEmptyString(dataset.addressLine2, quote.addressLine2),
    firstNonEmptyString(dataset.postcode, quote.postcode),
  );

  const address = firstNonEmptyString(
    dataset.address,
    dataset.customerAddress,
    quote.address,
    quote.customerAddress,
    quote.fullAddress,
    compositeAddress,
  );

  const mobile = firstNonEmptyString(
    dataset.mobile,
    dataset.phone,
    dataset.contactNumber,
    quote.mobile,
    quote.phone,
    quote.contactNumber,
  );

  return {
    email,
    emailLower: email ? email.toLowerCase() : null,
    name,
    address: address || "",
    mobile: mobile || "",
  };
}

function toJobDate(dateKey) {
  if (!dateKey) return null;
  const parsed = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildChatContextLabel(quote, dateKey) {
  const parts = [];
  const visitDate = toJobDate(dateKey) || (quote?.bookedDate ? new Date(quote.bookedDate) : null);
  if (visitDate && !Number.isNaN(visitDate.getTime())) {
    parts.push(
      `Visit ${visitDate.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })}`,
    );
  }
  const cleanerDisplay = quote?.assignedCleaner ? getCleanerLabel(quote.assignedCleaner) : null;
  if (cleanerDisplay) {
    parts.push(`Cleaner ${cleanerDisplay}`);
  }
  if (quote?.refCode) {
    parts.push(`Ref ${quote.refCode}`);
  }
  return parts.join(" • ");
}

export function createCustomerChatController({ db, auth, emailFrom, emailServiceId, emailTemplateId }) {
  const customerIdCache = new Map();

  function cacheCustomerId(quote, customerId, fallbackEmail = null) {
    if (!customerId) return;
    if (quote && quote.id) {
      customerIdCache.set(`quote:${quote.id}`, customerId);
    }
    const emailKeyFromQuote = getCustomerEmailKey(quote);
    const fallbackKey = typeof fallbackEmail === "string" ? fallbackEmail.trim().toLowerCase() : null;
    const emailKey = emailKeyFromQuote || fallbackKey;
    if (emailKey) {
      customerIdCache.set(`email:${emailKey}`, customerId);
    }
  }

  function getCachedCustomerId(quote) {
    if (!quote) return null;
    const inline = extractInlineCustomerId(quote);
    if (inline) return inline;
    if (quote.id) {
      const cachedByQuote = customerIdCache.get(`quote:${quote.id}`);
      if (cachedByQuote) return cachedByQuote;
    }
    const emailKey = getCustomerEmailKey(quote);
    if (emailKey) {
      const cachedByEmail = customerIdCache.get(`email:${emailKey}`);
      if (cachedByEmail) return cachedByEmail;
    }
    return null;
  }

  async function resolveCustomerIdFromQuote(quote, { jobCard = null, allowCreate = true } = {}) {
    const basics = extractCustomerBasics(quote, jobCard);
    const { email, name, address } = basics;

    const inlineId = getCachedCustomerId(quote);
    if (inlineId) {
      cacheCustomerId(quote, inlineId, email);
      if (quote) {
        quote.customerId = inlineId;
        if (!quote.email && email) {
          quote.email = email;
        }
      }
      if (jobCard?.dataset) {
        jobCard.dataset.customerId = inlineId;
      }
      return inlineId;
    }

    const jobCardId = normalizeCustomerIdValue(jobCard?.dataset?.customerId);
    if (jobCardId) {
      cacheCustomerId(quote, jobCardId, email);
      if (quote) {
        quote.customerId = jobCardId;
        if (!quote.email && email) {
          quote.email = email;
        }
      }
      return jobCardId;
    }

    if (!email) {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cachedId = customerIdCache.get(`email:${normalizedEmail}`);
    if (cachedId) {
      cacheCustomerId(quote, cachedId, email);
      if (quote) {
        quote.customerId = cachedId;
        if (!quote.email) {
          quote.email = email;
        }
      }
      if (jobCard?.dataset) {
        jobCard.dataset.customerId = cachedId;
      }
      return cachedId;
    }

    try {
      const firestoreInstance = db || getFirestore();
      const customersRef = collection(firestoreInstance, "customers");

      let snapshot = await getDocs(query(customersRef, where("email", "==", email), limit(1)));
      if (snapshot.empty && normalizedEmail !== email) {
        snapshot = await getDocs(
          query(customersRef, where("emailLower", "==", normalizedEmail), limit(1)),
        );
      }

      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        const customerId = docSnap.id;
        cacheCustomerId(quote, customerId, email);
        if (quote) {
          quote.customerId = customerId;
          if (!quote.email) {
            quote.email = email;
          }
        }
        if (jobCard?.dataset) {
          jobCard.dataset.customerId = customerId;
        }
        return customerId;
      }

      if (!allowCreate) {
        return null;
      }

      const payload = {
        name: name || "Customer",
        email,
        emailLower: normalizedEmail,
        address: address || "",
        createdAt: serverTimestamp(),
      };

      if (!payload.address) {
        delete payload.address;
      }

      const docRef = await addDoc(customersRef, payload);
      const newCustomerId = docRef.id;
      console.info("Created new customer:", newCustomerId);

      if (quote) {
        quote.customerId = newCustomerId;
        if (!quote.email) {
          quote.email = email;
        }
      }
      if (jobCard?.dataset) {
        jobCard.dataset.customerId = newCustomerId;
      }
      cacheCustomerId(quote, newCustomerId, email);
      return newCustomerId;
    } catch (error) {
      console.error("[ChatController] Failed to resolve or create customer", error);
      return null;
    }
  }

  function subscribeToCustomerMessages({ customerId, onUpdate, onError }) {
    if (!customerId) {
      return () => {};
    }
    try {
      const messagesRef = collection(db, "customers", customerId, "messages");
      const messagesQuery = query(
        messagesRef,
        orderBy("timestamp", "asc"),
        limitToLast(200),
      );
      return onSnapshot(
        messagesQuery,
        (snapshot) => {
          const entries = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
          onUpdate?.(entries);
        },
        (error) => {
          console.error("[ChatController] Chat subscription error", error);
          onError?.(error);
        },
      );
    } catch (error) {
      console.error("[ChatController] Failed to subscribe to chat", error);
      onError?.(error);
      return () => {};
    }
  }

  function getCurrentUserDisplay() {
    const user = auth.currentUser;
    if (!user) return "Swash Team";
    if (user.displayName) return user.displayName;
    if (user.email) return user.email;
    return "Swash Team";
  }

  async function sendCustomerChatMessage({ quote, customerId, message, jobDate }) {
    const body = (message || "").trim();
    if (!body) throw new Error("Message cannot be empty");
    if (!quote) throw new Error("Missing customer context");
    if (!customerId) throw new Error("Customer record not linked yet");

    const recipientEmail = (quote.email || quote.customerEmail || "").trim();
    const customerName = quote.customerName || quote.name || "Customer";
    const cleanerRaw = typeof quote.assignedCleaner === "string" ? quote.assignedCleaner.trim() : "";
    const cleanerName = cleanerRaw ? getCleanerLabel(cleanerRaw) : "Swash Team";
    const subject = `Message from ${cleanerName} @ Swash Cleaning Ltd`;

    if (recipientEmail) {
      if (!window.emailjs || typeof emailjs.send !== "function") {
        throw new Error("Email service not loaded");
      }
      const payload = {
        title: subject,
        name: customerName,
        message: `${body}\n\nSent from Swash Cleaning (${emailFrom})`,
        email: recipientEmail,
      };
      await emailjs.send(emailServiceId, emailTemplateId, payload);
      try {
        await logOutboundEmailToFirestore({
          to: recipientEmail,
          subject,
          body: payload.message,
          source: "chat",
        });
      } catch (logError) {
        console.warn("[ChatController] Failed to log outbound email", logError);
      }
    }

    const messagesRef = collection(db, "customers", customerId, "messages");
    const user = auth.currentUser;
    const jobDateValue = toJobDate(jobDate);
    const messageData = {
      direction: "outbound",
      type: recipientEmail ? "email" : "note",
      channel: recipientEmail ? "email" : "note",
      subject,
      body,
      preview: body.slice(0, 240),
      from: emailFrom,
      to: recipientEmail || null,
      author: getCurrentUserDisplay(),
      sentBy: user
        ? {
            uid: user.uid,
            email: user.email || null,
          }
        : null,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
      jobId: quote.id || null,
      jobDate: jobDateValue || null,
      jobStatus: quote.status || null,
    };

    await addDoc(messagesRef, messageData);
    cacheCustomerId(quote, customerId);
    return true;
  }

  async function markCustomerMessagesAsRead(customerId) {
    if (!customerId) {
      console.log("[ChatController] markCustomerMessagesAsRead: no customerId provided");
      return;
    }
    try {
      console.log("[ChatController] Starting to mark messages as read for customer", customerId);
      const messagesRef = collection(db, "customers", customerId, "messages");
      const unreadQuery = query(messagesRef, where("read", "==", false));
      const snapshot = await getDocs(unreadQuery);
      
      if (snapshot.empty) {
        console.log("[ChatController] No unread messages for customer", customerId);
        return;
      }

      const unreadCount = snapshot.docs.length;
      console.log("[ChatController] Found", unreadCount, "unread messages for customer", customerId);
      const batch = writeBatch(db);

      snapshot.docs.forEach((docSnap) => {
        batch.update(docSnap.ref, { read: true });
      });

      batch.update(doc(db, "customers", customerId), {
        "counters.unreadCount": increment(-unreadCount),
      });

      await batch.commit();
      console.log(`[ChatController] Successfully marked ${unreadCount} messages as read for customer ${customerId} and decremented counter`);
    } catch (error) {
      console.error("[ChatController] Failed to mark messages as read", error);
    }
  }

  async function openCommunicationsForQuote(
    quote,
    { occurrenceDateKey = null, jobCard = null, customerId: explicitCustomerId = null } = {},
  ) {
    const modal = window.CustomerChatModal;
    if (!modal || typeof modal.open !== "function") {
      console.warn("[ChatController] CustomerChatModal not loaded yet.");
      return;
    }

    try {
      let customerId = normalizeCustomerIdValue(explicitCustomerId);
      if (customerId) {
        cacheCustomerId(quote, customerId);
        if (quote) {
          quote.customerId = customerId;
        }
        if (jobCard?.dataset) {
          jobCard.dataset.customerId = customerId;
        }
      } else {
        customerId = await resolveCustomerIdFromQuote(quote, { jobCard, allowCreate: true });
      }
      if (!customerId) {
        alert("No linked customer record was found for this quote yet.");
        return;
      }

      const basics = extractCustomerBasics(quote, jobCard);
      const customer = {
        name: basics.name || "Customer",
        email: basics.email || "",
        address: basics.address || "",
        mobile: basics.mobile || "",
        refCode: quote?.refCode || quote?.reference || "",
      };

      cacheCustomerId(quote, customerId, basics.email);

      const contextLabel = buildChatContextLabel(quote, occurrenceDateKey);

      modal.open({
        customer,
        customerId,
        contextLabel,
        subscribeMessages: ({ onUpdate, onError }) =>
          subscribeToCustomerMessages({ customerId, onUpdate, onError }),
        onSend: (body) =>
          sendCustomerChatMessage({
            quote,
            customerId,
            message: body,
            jobDate: occurrenceDateKey,
          }),
      });

      await markCustomerMessagesAsRead(customerId);
    } catch (error) {
      console.error("[ChatController] Failed to open communications modal", error);
      alert("Unable to open communications right now. Please try again.");
    }
  }

  return {
    cacheCustomerId,
    getCachedCustomerId,
    resolveCustomerIdFromQuote,
    openCommunicationsForQuote,
    buildChatContextLabel,
  };
}
