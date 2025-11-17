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

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
