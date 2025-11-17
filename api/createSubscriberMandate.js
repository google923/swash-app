// Vercel serverless function: Create a GoCardless recurring Direct Debit mandate
// For subscriber monthly billing setup
// Returns { redirect_url, mandate_id }

/**
 * Helper: pick GoCardless API host based on env
 */
function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

/**
 * POST /api/createSubscriberMandate
 * Body: { 
 *   subscriberId: string,
 *   companyName: string,
 *   email: string,
 *   monthlyAmount: number (pennies)
 * }
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

  const { subscriberId, companyName, email, monthlyAmount } = req.body || {};

  if (!subscriberId || !companyName || !email) {
    return res.status(400).json({ error: 'Missing required fields: subscriberId, companyName, email' });
  }

  const amountInt = Number.isFinite(monthlyAmount) ? Math.round(Number(monthlyAmount)) : NaN;
  if (!Number.isFinite(amountInt) || amountInt <= 0) {
    return res.status(400).json({ error: 'Invalid monthlyAmount. Provide integer pennies.' });
  }

  const host = getGcHost();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
  };

  try {
    // 1) Create Billing Request for Direct Debit mandate
    const brResp = await fetch(`${host}/billing_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_requests: {
          mandate_request: {
            scheme: 'bacs', // UK Direct Debit
            currency: 'GBP',
          },
          metadata: {
            subscriber_id: subscriberId,
            monthly_amount: String(amountInt),
            purpose: 'swash_subscription',
          },
        },
      }),
    });

    if (!brResp.ok) {
      const text = await brResp.text();
      console.error('GoCardless billing request error:', text);
      return res.status(502).json({ error: 'Failed to create billing request', details: text });
    }

    const brData = await brResp.json();
    const billingRequest = brData && (brData.billing_requests || brData.billing_request);
    const billingRequestId = billingRequest && billingRequest.id;
    
    if (!billingRequestId) {
      return res.status(502).json({ error: 'Billing request ID not returned' });
    }

    // 2) Create Billing Request Flow with redirect URL
    const successUrl = `https://app.swashcleaning.co.uk/subscriber-billing-complete.html?subscriber_id=${subscriberId}&mandate_request=${billingRequestId}`;
    
    const brfResp = await fetch(`${host}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: successUrl,
          exit_uri: successUrl,
          links: { billing_request: billingRequestId },
          prefilled_customer: {
            company_name: companyName,
            email: email,
          },
        },
      }),
    });

    if (!brfResp.ok) {
      const text = await brfResp.text();
      console.error('GoCardless billing request flow error:', text);
      return res.status(502).json({ error: 'Failed to create billing request flow', details: text });
    }

    const brfData = await brfResp.json();
    const flow = brfData && (brfData.billing_request_flows || brfData.billing_request_flow);
    const redirectUrl = flow && (flow.authorisation_url || flow.authorization_url);
    
    if (!redirectUrl) {
      return res.status(502).json({ error: 'Authorisation URL not returned' });
    }

    return res.status(200).json({ 
      redirect_url: redirectUrl, 
      mandate_request_id: billingRequestId 
    });

  } catch (err) {
    console.error('Unexpected error creating mandate:', err);
    return res.status(500).json({ 
      error: 'Unexpected error creating Direct Debit mandate', 
      message: String(err && err.message || err) 
    });
  }
};
