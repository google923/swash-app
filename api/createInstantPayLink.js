// Vercel serverless function: Create a GoCardless Instant Bank Pay session
// Returns { redirect_url, session_id }

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

function buildReturnUrl(billingRequestId) {
  const baseUrl = process.env.SMS_PAY_RETURN_URL || 'https://app.swashcleaning.co.uk/subscriber-sms-setup.html';
  if (!billingRequestId) return baseUrl;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('billing_request_id', billingRequestId);
    return url.toString();
  } catch (_) {
    return baseUrl;
  }
}

/**
 * POST /api/createInstantPayLink
 * Body: { amount: number (pennies), currency?: 'GBP', description?: string }
 */
module.exports = async (req, res) => {
  const corsAllowed = applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!corsAllowed) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!corsAllowed) {
    return res.status(403).json({ error: 'Origin not allowed' });
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
    const returnUrl = buildReturnUrl(billingRequestId);

    const brfResp = await fetch(`${host}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: returnUrl,
          exit_uri: returnUrl,
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
    const redirectFlowId = flow && (flow.id || flow.redirect_flow_id || flow.redirectFlowId);
    if (!redirectUrl) {
      return res.status(502).json({ error: 'Authorisation URL not returned' });
    }

    const credits = req.body && Number(req.body.credits);

    return res.status(200).json({
      redirect_url: redirectUrl,
      session_id: billingRequestId,
      redirect_flow_id: redirectFlowId || null,
      credits: Number.isFinite(credits) ? credits : null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error creating payment link', message: String(err && err.message || err) });
  }
};
