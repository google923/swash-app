/**
 * Firebase Cloud Functions for handling inbound Zoho Mail webhooks.
 *
 * Ensure you configure the required secrets before deployment:
 *   firebase functions:config:set \
 *     zoho.client_secret="YOUR_SECRET" \
 *     zoho.auth_token="YOUR_AUTH_TOKEN"
 */

const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const secretClient = new SecretManagerServiceClient();

const REGION = "us-central1";
const EMAIL_SETTINGS_DOC_ID = "emailSettings";
const EMAIL_PRIVATE_COLLECTION = "private";
const EMAIL_LOG_COLLECTION = "emailLogs";

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID;
}

async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    return null;
  }
  return { id: uid, ...snap.data() };
}

function assertEmail(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} is required`);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value.trim().toLowerCase())) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} must be a valid email address`);
  }
  return value.trim();
}

async function resolveSubscriberContext(context, data = {}) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required");
  }

  const actor = await getUserProfile(context.auth.uid);
  if (!actor) {
    throw new functions.https.HttpsError("permission-denied", "User profile not found");
  }

  let targetSubscriberId = actor.id;
  if (actor.role === "admin" && data.subscriberId) {
    targetSubscriberId = data.subscriberId;
  }

  if (actor.role !== "admin" && actor.id !== targetSubscriberId) {
    throw new functions.https.HttpsError("permission-denied", "You do not own this subscriber account");
  }

  const subscriberProfile = await getUserProfile(targetSubscriberId);
  if (!subscriberProfile || subscriberProfile.role !== "subscriber") {
    throw new functions.https.HttpsError("not-found", "Subscriber account not found");
  }

  if (!subscriberProfile.billingCompleted) {
    throw new functions.https.HttpsError("failed-precondition", "Complete billing setup to enable email settings");
  }

  return {
    actor,
    subscriberId: targetSubscriberId,
    subscriberProfile,
  };
}

async function ensureSecretExists(parent, secretId) {
  const name = `${parent}/secrets/${secretId}`;
  try {
    await secretClient.getSecret({ name });
    return name;
  } catch (err) {
    if (err.code === 5 || err.code === 404) {
      const [secret] = await secretClient.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
      return secret.name;
    }
    throw err;
  }
}

async function storeSmtpPassword(subscriberId, password) {
  const value = typeof password === "string" ? password.trim() : "";
  if (!value) {
    throw new functions.https.HttpsError("invalid-argument", "SMTP password cannot be empty");
  }
  const project = projectId();
  if (!project) {
    throw new functions.https.HttpsError("internal", "Unable to resolve project ID for Secret Manager");
  }
  const parent = `projects/${project}`;
  const secretId = `subscriber-smtp-${subscriberId}`;
  const secretName = await ensureSecretExists(parent, secretId);
  await secretClient.addSecretVersion({
    parent: secretName,
    payload: { data: Buffer.from(value, "utf8") },
  });
  return secretName;
}

async function retrieveSmtpPassword(subscriberId) {
  const project = projectId();
  if (!project) {
    throw new functions.https.HttpsError("internal", "Unable to resolve project ID for Secret Manager");
  }
  const secretName = `projects/${project}/secrets/subscriber-smtp-${subscriberId}/versions/latest`;
  try {
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    const payload = version?.payload?.data;
    if (!payload) {
      throw new functions.https.HttpsError("failed-precondition", "SMTP password not set");
    }
    return payload.toString("utf8");
  } catch (err) {
    if (err.code === 5 || err.code === 404) {
      throw new functions.https.HttpsError("failed-precondition", "SMTP password not set");
    }
    throw err;
  }
}

function sanitizeEmailSettings(input = {}) {
  const host = typeof input.host === "string" ? input.host.trim() : "";
  if (!host) {
    throw new functions.https.HttpsError("invalid-argument", "SMTP host is required");
  }

  const port = Number(input.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new functions.https.HttpsError("invalid-argument", "SMTP port must be a valid integer between 1 and 65535");
  }

  const fromEmail = assertEmail(input.fromEmail || "", "From email");
  const fromName = typeof input.fromName === "string" ? input.fromName.trim() : "";
  const requireAuth = input.requireAuth !== false;
  const username = requireAuth ? (typeof input.username === "string" ? input.username.trim() : "") : "";
  if (requireAuth && !username) {
    throw new functions.https.HttpsError("invalid-argument", "SMTP username is required when authentication is enabled");
  }

  const minSendMinutesRaw = Number(input.minSendMinutes ?? 0);
  if (Number.isNaN(minSendMinutesRaw) || minSendMinutesRaw < 0 || minSendMinutesRaw > 1440) {
    throw new functions.https.HttpsError("invalid-argument", "Minimum minutes between sends must be between 0 and 1440");
  }

  return {
    host,
    port,
    fromEmail,
    fromName,
    requireAuth,
    username: requireAuth ? username : null,
    useStartTls: Boolean(input.useStartTls),
    minSendMinutes: minSendMinutesRaw,
  };
}

function buildTransportOptions(settings, password) {
  const secure = !settings.useStartTls && settings.port === 465;
  const transport = {
    host: settings.host,
    port: settings.port,
    secure,
  };

  if (settings.requireAuth) {
    transport.auth = {
      user: settings.username,
      pass: password,
    };
  }

  if (settings.useStartTls) {
    transport.requireTLS = true;
    transport.tls = {
      minVersion: "TLSv1.2",
    };
  }

  return transport;
}

function sanitizeEmailPayload(payload = {}) {
  const to = assertEmail(payload.to || "", "Recipient");
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  if (!subject) {
    throw new functions.https.HttpsError("invalid-argument", "Subject is required");
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const html = typeof payload.html === "string" ? payload.html.trim() : "";
  if (!text && !html) {
    throw new functions.https.HttpsError("invalid-argument", "Email text or HTML content is required");
  }

  const replyTo = payload.replyTo ? assertEmail(payload.replyTo, "Reply-To") : undefined;
  const template = typeof payload.template === "string" && payload.template.trim().length ? payload.template.trim() : null;
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null;

  return {
    to,
    subject,
    text: text || undefined,
    html: html || undefined,
    replyTo,
    template,
    metadata,
  };
}

async function getEmailSettingsSnapshot(subscriberId) {
  const ref = db
    .collection("subscribers")
    .doc(subscriberId)
    .collection(EMAIL_PRIVATE_COLLECTION)
    .doc(EMAIL_SETTINGS_DOC_ID);
  const snap = await ref.get();
  return { ref, snap };
}

exports.saveSubscriberEmailSettings = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const payload = typeof data === "object" && data ? data : {};
    const { actor, subscriberId } = await resolveSubscriberContext(context, payload);

    const settings = sanitizeEmailSettings(payload.settings || {});

    const subscriberDocRef = db.collection("subscribers").doc(subscriberId);
    const { ref, snap } = await getEmailSettingsSnapshot(subscriberId);
    const existing = snap.exists ? snap.data() : null;

    if (settings.requireAuth) {
      const passwordProvided = typeof payload.password === "string" && payload.password.trim().length > 0;
      if (!passwordProvided) {
        try {
          await retrieveSmtpPassword(subscriberId);
        } catch (err) {
          if (err instanceof functions.https.HttpsError && err.code === "failed-precondition") {
            throw new functions.https.HttpsError(
              "invalid-argument",
              "SMTP password is required when authentication is enabled",
            );
          }
          throw err;
        }
      }
    }

    if (settings.requireAuth && settings.username) {
      assertEmail(settings.username, "SMTP username");
    }

    const updates = {
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: {
        uid: actor.id,
        email: actor.email || null,
        name: actor.name || actor.displayName || null,
      },
      configured: true,
    };

    if (existing?.lastSentAt) {
      updates.lastSentAt = existing.lastSentAt;
    }
    if (existing?.lastErrorAt) {
      updates.lastErrorAt = existing.lastErrorAt;
      updates.lastErrorMessage = existing.lastErrorMessage || null;
    }

    if (typeof payload.password === "string" && payload.password.trim().length) {
      updates.passwordUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
      await storeSmtpPassword(subscriberId, payload.password);
    }

    await ref.set(updates, { merge: true });

    return { success: true };
  });

exports.sendSubscriberEmail = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const payload = typeof data === "object" && data ? data : {};
    const { actor, subscriberId } = await resolveSubscriberContext(context, payload);

    const { ref, snap } = await getEmailSettingsSnapshot(subscriberId);
    if (!snap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "Email settings not configured");
    }
    const settings = snap.data() || {};

    const password = settings.requireAuth ? await retrieveSmtpPassword(subscriberId) : null;
    if (settings.requireAuth && !password) {
      throw new functions.https.HttpsError("failed-precondition", "SMTP password not set");
    }

    const emailPayload = sanitizeEmailPayload(payload.email || {});

    const now = admin.firestore.Timestamp.now();
    const minMinutes = Number(settings.minSendMinutes ?? 0);
    if (minMinutes > 0 && settings.lastSentAt?.toDate) {
      const lastSentMs = settings.lastSentAt.toDate().getTime();
      const nextAllowed = lastSentMs + minMinutes * 60 * 1000;
      if (Date.now() < nextAllowed) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "Emails can only be sent every " + minMinutes + " minute(s)",
        );
      }
    }

    const transportOptions = buildTransportOptions(settings, password);
    const transporter = nodemailer.createTransport(transportOptions);

    const message = {
      to: emailPayload.to,
      subject: emailPayload.subject,
      from: settings.fromName ? `${settings.fromName} <${settings.fromEmail}>` : settings.fromEmail,
      text: emailPayload.text,
      html: emailPayload.html,
      replyTo: emailPayload.replyTo,
    };

    let info;
    try {
      info = await transporter.sendMail(message);
    } catch (error) {
      await ref.set(
        {
          lastErrorAt: now,
          lastErrorMessage: error?.message || String(error),
          lastSentAt: null,
          lastSentMessageId: null,
        },
        { merge: true },
      );

      await subscriberDocRef
        .collection(EMAIL_LOG_COLLECTION)
        .add({
          subscriberId,
          type: emailPayload.template || "custom",
          to: emailPayload.to,
          subject: emailPayload.subject,
          sentAt: now,
          status: "error",
          error: error?.message || String(error),
          actor: {
            uid: actor.id,
            email: actor.email || null,
          },
          metadata: emailPayload.metadata || null,
        });

      throw new functions.https.HttpsError("internal", "Failed to send email", error?.message || String(error));
    }

    await ref.set(
      {
        lastSentAt: now,
        lastSentMessageId: info?.messageId || null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
      { merge: true },
    );

    await subscriberDocRef
      .collection(EMAIL_LOG_COLLECTION)
      .add({
        subscriberId,
        type: emailPayload.template || "custom",
        to: emailPayload.to,
        subject: emailPayload.subject,
        sentAt: now,
        status: "sent",
        messageId: info?.messageId || null,
        envelope: info?.envelope || null,
        actor: {
          uid: actor.id,
          email: actor.email || null,
        },
        metadata: emailPayload.metadata || null,
      });

    return {
      success: true,
      messageId: info?.messageId || null,
      envelope: info?.envelope || null,
    };
  });

const MAIL_THREADS_COLLECTION = "mailThreads";
const CUSTOMERS_COLLECTION = "customers";

/**
 * Best effort HTML -> plain text normaliser.
 * Removes script/style blocks and collapses whitespace.
 * @param {string} input
 * @returns {string}
 */
function toPlainText(input = "") {
  if (typeof input !== "string" || input.trim().length === 0) {
    return "";
  }

  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function safeCompare(a = "", b = "") {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

exports.zohoInboundEmail = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 30,
    memory: "256MB",
  })
  .https.onRequest(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Zoho-Mail-Webhook-Signature");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Zoho-Mail-Webhook-Signature");

    const secret = functions.config().zoho?.client_secret;
    if (!secret) {
      functions.logger.error("Missing Zoho client_secret in functions config");
      return res.status(500).json({ success: false, error: "Server not configured" });
    }

    const signature = req.get("X-Zoho-Mail-Webhook-Signature") || "";
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.rawBody || Buffer.from(""))
      .digest("hex");

    if (!safeCompare(signature, computedSignature)) {
      functions.logger.warn("Invalid Zoho webhook signature", { signature });
      return res.status(401).json({ success: false, error: "Invalid signature" });
    }

    const payload = req.body || {};
    functions.logger.info("Zoho inbound raw payload", payload);

    const fromAddress = payload.fromAddress || payload.from || "";
    const toAddress = payload.toAddress || "";
    const subject = payload.subject || "";
    const content = payload.content || payload.text || "";
    const receivedTime = payload.receivedTime || Date.now();

    if (!fromAddress) {
      functions.logger.warn("Webhook payload missing fromAddress", payload);
      return res.status(400).json({ success: false, error: "Missing fromAddress" });
    }

    const plainText = toPlainText(content);
    const timestampDate = new Date(receivedTime);
    if (Number.isNaN(timestampDate.getTime())) {
      timestampDate.setTime(Date.now());
    }
    const timestamp = admin.firestore.Timestamp.fromDate(timestampDate);

    try {
      let customerSnap = await db
        .collection(CUSTOMERS_COLLECTION)
        .where("email", "==", fromAddress)
        .limit(1)
        .get();

      if (customerSnap.empty) {
        customerSnap = await db
          .collection(CUSTOMERS_COLLECTION)
          .where("emailLower", "==", fromAddress.toLowerCase())
          .limit(1)
          .get();
      }

      if (customerSnap.empty) {
        functions.logger.warn("No customer matched inbound email", { fromAddress, subject });
        return res.status(200).json({ success: true, message: "customer_not_found" });
      }

      const customerDoc = customerSnap.docs[0];
      const customerId = customerDoc.id;

      const threadRef = db.collection(MAIL_THREADS_COLLECTION).doc(customerId);
      const messageRef = threadRef.collection("messages").doc();
      const preview = plainText ? plainText.slice(0, 240) : subject.slice(0, 240);

      await db.runTransaction(async (tx) => {
        tx.set(messageRef, {
          direction: "in",
          from: fromAddress,
          to: toAddress,
          subject,
          text: plainText,
          rawContent: content,
          timestamp,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(
          threadRef,
          {
            customerId,
            customerEmail: fromAddress,
            unreadCount: admin.firestore.FieldValue.increment(1),
            lastMessagePreview: preview,
            lastSubject: subject,
            lastInboundAt: timestamp,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      functions.logger.info("Inbound email stored", { customerId, messageId: messageRef.id });
      return res.status(200).json({ success: true });
    } catch (error) {
      functions.logger.error("Failed to store inbound email", { error: error?.message, stack: error?.stack });
      return res.status(500).json({ success: false, error: "Failed to persist message" });
    }
  });
