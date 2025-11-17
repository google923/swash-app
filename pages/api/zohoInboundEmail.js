const getRawBody = require("raw-body");

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-zoho-mail-webhook-signature");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ success: true, message: "Preflight OK" });
  }

  try {
    if (req.method === "GET") {
      console.log("[ZohoWebhook] Received GET test ping");
      return res.status(200).json({ success: true, message: "Test GET OK" });
    }

    if (req.method === "POST") {
      const rawBody = (await getRawBody(req)).toString("utf8");
      console.log("[ZohoWebhook] Raw POST body:", rawBody);
      return res.status(200).json({ success: true });
    }

    console.log(`[ZohoWebhook] Unsupported method ${req.method}`);
    return res.status(200).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    console.error("[ZohoWebhook] Handler error", error);
    return res.status(200).json({ success: false, error: error?.message || "Unknown error" });
  }
}
