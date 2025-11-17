// Vercel serverless function: Create a GoCardless Instant Bank Pay session
// Returns { redirect_url, session_id }

/**
 * Helper: pick GoCardless API host based on env
 */
function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

/**
 * POST /api/createInstantPayLink
 * Body: { amount: number (pennies), currency?: 'GBP', description?: string }
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GoCardless credentials (GC_API_KEY)' });
  }

  const { amount, currency = 'GBP', description, customerName, repName } = req.body || {};
  const desc = (function() {
    if (description && String(description).trim().length > 0) return String(description).trim();
    const cust = (customerName && String(customerName).trim()) || 'Customer';
    const rep = (repName && String(repName).trim()) || 'Unknown';
    return `Payment from ${cust} for 3 window cleans - Rep ${rep}`;
  })();
  const amountInt = Number.isFinite(amount) ? Math.round(Number(amount)) : NaN;

  if (!Number.isFinite(amountInt) || amountInt <= 0) {
    return res.status(400).json({ error: 'Invalid amount. Provide integer pennies in `amount`.' });
  }

  const host = getGcHost();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
  };

  try {
    // 1) Create Billing Request for an Instant Bank Pay payment
    const brResp = await fetch(`${host}/billing_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_requests: {
          payment_request: {
            description: desc,
            amount: amountInt, // integer pennies
            currency,
            scheme: 'faster_payments',
          },
        },
      }),
    });

    if (!brResp.ok) {
      const text = await brResp.text();
      return res.status(502).json({ error: 'Failed to create billing request', details: text });
    }
    const brData = await brResp.json();
    const billingRequest = brData && (brData.billing_requests || brData.billing_request || brData.billingRequests);
    const billingRequestId = billingRequest && billingRequest.id;
    if (!billingRequestId) {
      return res.status(502).json({ error: 'Billing request ID not returned' });
    }

    // 2) Create Billing Request Flow to obtain an authorisation URL
    const brfResp = await fetch(`${host}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          // redirect_uri is optional; GoCardless provides a thank-you page by default
          links: { billing_request: billingRequestId },
        },
      }),
    });

    if (!brfResp.ok) {
      const text = await brfResp.text();
      return res.status(502).json({ error: 'Failed to create billing request flow', details: text });
    }
    const brfData = await brfResp.json();
    const flow = brfData && (brfData.billing_request_flows || brfData.billingRequestFlows);
    const redirectUrl = flow && (flow.authorisation_url || flow.authorization_url || flow.redirect_url);
    if (!redirectUrl) {
      return res.status(502).json({ error: 'Authorisation URL not returned' });
    }

    return res.status(200).json({ redirect_url: redirectUrl, session_id: billingRequestId });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error creating payment link', message: String(err && err.message || err) });
  }
};
