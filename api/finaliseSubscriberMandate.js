// Vercel serverless function: Finalise a GoCardless mandate and create a monthly subscription for a subscriber
// Input: { subscriberId, billingRequestId, monthlyAmount } where monthlyAmount is integer pennies
// Output: { mandate_id, subscription_id }

function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GoCardless credentials (GC_API_KEY)' });
  }

  const { subscriberId, billingRequestId, monthlyAmount } = req.body || {};
  if (!subscriberId || !billingRequestId) {
    return res.status(400).json({ error: 'Missing required fields: subscriberId, billingRequestId' });
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
    // 1) Retrieve billing request to obtain mandate id
    const brResp = await fetch(`${host}/billing_requests/${billingRequestId}`, {
      method: 'GET',
      headers,
    });

    if (!brResp.ok) {
      const text = await brResp.text();
      return res.status(502).json({ error: 'Failed to fetch billing request', details: text });
    }
    const brData = await brResp.json();
    const br = brData.billing_requests || brData.billing_request || brData;
    const links = br && (br.links || br.data?.links);
    const mandateId = links && (links.mandate || links.mandate_id);

    if (!mandateId) {
      // Mandate might not be ready yet (asynchronous). Caller can retry after a short delay.
      return res.status(409).json({ error: 'Mandate not ready yet. Please retry shortly.' });
    }

    // 2) Create a monthly subscription using the mandate
    const subResp = await fetch(`${host}/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subscriptions: {
          name: 'Swash System Subscription',
          amount: amountInt,
          currency: 'GBP',
          interval_unit: 'monthly',
          links: { mandate: mandateId },
          metadata: { subscriber_id: String(subscriberId) },
        },
      }),
    });

    if (!subResp.ok) {
      const text = await subResp.text();
      return res.status(502).json({ error: 'Failed to create subscription', details: text });
    }

    const subData = await subResp.json();
    const sub = subData.subscriptions || subData.subscription || subData;
    const subscriptionId = sub && (sub.id || sub.subscription_id);

    if (!subscriptionId) {
      return res.status(502).json({ error: 'Subscription ID not returned' });
    }

    return res.status(200).json({ mandate_id: mandateId, subscription_id: subscriptionId });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error finalising mandate', message: String(err && err.message || err) });
  }
};
