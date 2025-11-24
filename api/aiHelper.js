// Vercel API route that proxies to Firebase Cloud Functions
// This allows the client to call /api/aiHelper instead of the direct Firebase URL

const axios = require('axios');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { question, subscriberId, context } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization' });
    }

    if (!question || !subscriberId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const token = authHeader.substring(7);

    console.log('🤖 AI Helper API called for subscriber:', subscriberId);

    // Call the Firebase Cloud Function
    const response = await axios.post(
      'https://us-central1-swash-app-436a1.cloudfunctions.net/aiHelper',
      {
        question,
        subscriberId,
        context
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );

    console.log('✅ AI Helper response:', response.data);
    return res.status(200).json(response.data);
  } catch (error) {
    console.error('❌ API error:', error.message);
    const status = error.response?.status || 500;
    const message = error.response?.data?.error || error.message || 'Internal server error';
    return res.status(status).json({ error: message });
  }
};
