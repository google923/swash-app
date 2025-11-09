// Vercel Serverless Function: Proxy for sending SMS via VoodooSMS
// Do NOT expose your provider API key in the browser. Set these env vars in Vercel:
// - VOODOO_SMS_API_KEY
// - VOODOO_SMS_SENDER (alphanumeric sender or approved number)
// Optional override:
// - VOODOO_SMS_API_URL (defaults to a reasonable VoodooSMS endpoint guess)
//
// Client should POST JSON: { to: "+44xxxxxxxxxx", message: "..." }

export default async function handler(req, res) {
  // --- CORS handling (supports cross-origin from your app domain) ---
  const requestOrigin = req.headers.origin || '';
  const allowedEnv = process.env.SMS_ALLOWED_ORIGIN || '*';
  const allowAny = allowedEnv === '*' || !allowedEnv;
  const isAllowed = allowAny || (requestOrigin && requestOrigin === allowedEnv);

  // Always set Vary so caches don’t mix origins
  res.setHeader('Vary', 'Origin');
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : requestOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Preflight
  if (req.method === 'OPTIONS') {
    if (!isAllowed) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { to, message, sender } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing to or message' });
    }

  const API_KEY = process.env.VOODOO_SMS_API_KEY;
  const SENDER = sender || process.env.VOODOO_SMS_SENDER || 'Swashclean';
    const API_URL = process.env.VOODOO_SMS_API_URL || 'https://api.voodoosms.com/messages';

    if (!API_KEY) {
      return res.status(500).json({ error: 'SMS not configured: VOODOO_SMS_API_KEY missing' });
    }

    // Minimal origin check to reduce abuse surface (best effort only)
    if (!isAllowed) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    // Attempt a generic VoodooSMS-style JSON request. Adjust API_URL via env if needed.
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, message, from: SENDER })
    });

    const text = await upstream.text();
    const statusOk = upstream.ok;

    // Try to parse JSON; fall back to raw text
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

    if (!statusOk) {
      return res.status(upstream.status || 502).json({ error: 'Upstream SMS error', details: data });
    }

    return res.status(200).json({ success: true, provider: 'voodoosms', response: data });
  } catch (err) {
    console.error('[send-sms] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
