// Vercel Serverless Function: Nearby road name suggestions
// Aggregates Overpass (with fallback endpoints) and Nominatim in one call.
// Returns { names: string[], source: 'overpass'|'nominatim'|'none' }
// Caches responses by CDN to reduce rate/timeout issues.

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = process.env.GEO_ALLOWED_ORIGIN || '*';
  const allowAny = allowed === '*' || !allowed;
  const isAllowed = allowAny || (origin && origin === allowed);

  res.setHeader('Vary', 'Origin');
  if (isAllowed) res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const toFloat = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const lat = toFloat(req.query.lat ?? req.query.latitude);
  const lng = toFloat(req.query.lng ?? req.query.lon ?? req.query.longitude);
  if (lat == null || lng == null) return res.status(400).json({ error: 'Invalid lat/lng' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    // Progressive Overpass search
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];
    const radii = [25, 60, 100];

    const fetchJson = async (url, opts={}) => {
      const r = await fetch(url, {
        ...opts,
        headers: { 'Accept': 'application/json', 'User-Agent': process.env.GEO_USER_AGENT || 'SwashCleaning/1.0 (https://app.swashcleaning.co.uk)' },
        signal: controller.signal
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!r.ok) throw Object.assign(new Error('Upstream error'), { status: r.status, data });
      return data;
    };

    for (const radius of radii) {
      const query = `
        [out:json][timeout:6];
        (
          way(around:${radius},${lat},${lng})["highway"]["name"];
          node(around:${radius},${lat},${lng})["addr:street"];
          node(around:${radius},${lat},${lng})["name"];
        );
        out tags;`;

      for (const ep of endpoints) {
        try {
          const url = `${ep}?data=${encodeURIComponent(query)}`;
          const data = await fetchJson(url);
          const elements = Array.isArray(data.elements) ? data.elements : [];
          const names = Array.from(new Set(elements.map(e => {
            const t = e.tags || {}; return t.name || t['addr:street'] || null;
          }).filter(Boolean)));
          if (names.length) {
            clearTimeout(timeout);
            res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
            return res.status(200).json({ names, source: 'overpass' });
          }
        } catch (_) {
          // try next endpoint or radius
        }
      }
    }

    // Fallback: single Nominatim reverse for a usable place/road
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('addressdetails', '1');
      const data = await fetchJson(url.toString());
      const addr = data.address || {};
      const rd = addr.road || addr.residential || addr.pedestrian || addr.suburb || addr.hamlet || addr.village || addr.town || addr.city || addr.county;
      const names = rd ? [rd] : [];
      clearTimeout(timeout);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
      return res.status(200).json({ names, source: names.length ? 'nominatim' : 'none' });
    } catch (_) {}

    clearTimeout(timeout);
    return res.status(200).json({ names: [], source: 'none' });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(200).json({ names: [], source: 'none', error: err?.message || 'timeout' });
  }
}
