// Vercel serverless function: Check GoCardless Billing Request status
// Maps to simple statuses for the front-end poller

function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GoCardless credentials (GC_API_KEY)' });
  }

  const id = req.query && (req.query.id || req.query.session_id);
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  const host = getGcHost();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'GoCardless-Version': '2015-07-06',
  };

  try {
    const resp = await fetch(`${host}/billing_requests/${encodeURIComponent(id)}`, { headers });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ error: 'Failed to retrieve billing request', details: text });
    }
    const data = await resp.json();
    const br = data && (data.billing_requests || data.billingRequest || data.billingRequests);
    const status = br && br.status ? String(br.status).toLowerCase() : 'pending';

    let mapped = 'pending';
    if (status === 'fulfilled') mapped = 'confirmed';
    else if (status === 'cancelled') mapped = 'cancelled';
    else if (status === 'ready_to_fulfil') mapped = 'authorised';

    return res.status(200).json({ status: mapped, raw_status: status });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error checking status', message: String(err && err.message || err) });
  }
};
