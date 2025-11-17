// Vercel Serverless Function: Reverse geocoding proxy for Nominatim
// Why: Nominatim does not set CORS headers for browser calls from your domain,
// so direct fetches fail with CORS/403. This serverless proxy performs the
// request server-side with a compliant User-Agent and returns JSON with
// Access-Control-Allow-Origin so the browser can consume it safely.
// Usage (client): GET /api/reverse-geocode?lat=51.5&lng=-0.12

export default async function handler(req, res) {
  // Basic CORS handling
  const origin = req.headers.origin || '';
  const allowed = process.env.GEO_ALLOWED_ORIGIN || '*';
  const allowAny = allowed === '*' || !allowed;
  const isAllowed = allowAny || (origin && origin === allowed);

  res.setHeader('Vary', 'Origin');
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    if (!isAllowed) return res.status(403).json({ error: 'Origin not allowed' });
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const lat = parseFloat(req.query.lat ?? req.query.latitude);
    const lng = parseFloat(req.query.lng ?? req.query.lon ?? req.query.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Invalid lat/lng' });
    }

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('addressdetails', '1');

    const upstream = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        // Identify your app per Nominatim usage policy
        'User-Agent': process.env.GEO_USER_AGENT || 'SwashCleaning/1.0 (https://app.swashcleaning.co.uk)'
      },
      // Avoid caching at Nominatim accidentally; we will set downstream cache headers
      cache: 'no-store'
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstream.ok) {
      return res.status(upstream.status || 502).json({ error: 'Upstream error', details: data });
    }

    // Cache for a day on the CDN layer, clients can also cache
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[reverse-geocode] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
