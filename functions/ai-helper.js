const functions = require('firebase-functions');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const axios = require('axios');
const admin = require('firebase-admin');

const client = new SecretManagerServiceClient();

// Initialize admin SDK if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Get OpenAI API key from Secret Manager
 */
async function getOpenAIKey() {
  try {
    const projectId = process.env.GCLOUD_PROJECT;
    const name = `projects/${projectId}/secrets/openai-api-key/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    return version.payload.data.toString();
  } catch (error) {
    console.error('Failed to get OpenAI key from Secret Manager:', error);
    throw new Error('AI service not configured');
  }
}

/**
 * Verify Firebase token and get user/subscriber info
 */
async function verifyToken(token) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Unauthorized');
  }
}

/**
 * AI Helper HTTP endpoint - processes user questions with context
 * POST /aiHelper
 */
exports.aiHelper = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get auth token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization' });
      return;
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;
    console.log('✅ Token verified for user:', userId);

    const { question, subscriberId, context: queryContext } = req.body;

    if (!question || !subscriberId) {
      res.status(400).json({ error: 'Missing required fields: question, subscriberId' });
      return;
    }

    console.log('🤖 AI Helper request for subscriber:', subscriberId, 'question:', question);

    const apiKey = await getOpenAIKey();

    // Build system prompt
    const systemPrompt = `You are a helpful AI assistant for Swash, a window cleaning management app.
You help subscribers manage their cleaning business including:
- Organizing cleaning routes and schedules
- Tracking cleaner assignments and workload
- Managing customer bookings
- Weather-based scheduling
- Repeat customer management
- Pricing and quotes

Be concise, friendly, and practical. Provide actionable advice.
Current date/time: ${new Date().toISOString()}`;

    let userMessage = question;
    if (queryContext) {
      userMessage = `Context: ${JSON.stringify(queryContext)}\n\nQuestion: ${question}`;
    }

    console.log('📤 Calling OpenAI...');

    // Call OpenAI API
    let response;
    try {
      response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 300
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (axiosError) {
      console.error('OpenAI API error:', axiosError.response?.data || axiosError.message);
      const statusCode = axiosError.response?.status || 500;
      const errorMessage = axiosError.response?.data?.error?.message || axiosError.message || 'Failed to call OpenAI API';
      res.status(statusCode).json({ error: errorMessage });
      return;
    }

    console.log('✅ OpenAI response received');

    // Validate response structure
    if (!response.data?.choices?.[0]?.message?.content) {
      console.error('Invalid OpenAI response structure:', response.data);
      res.status(500).json({ error: 'Invalid response from OpenAI' });
      return;
    }

    res.json({
      answer: response.data.choices[0].message.content,
      success: true
    });
  } catch (error) {
    console.error('AI Helper error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Get cleaner workload for next week
 * GET /cleaner-workload?subscriberId=xxx&cleanerName=xxx
 */
exports.getCleanerWorkload = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { subscriberId, cleanerName } = data;
  
  // Query Firestore for quotes assigned to this cleaner
  const admin = require('firebase-admin');
  const db = admin.firestore();

  try {
    const quotesRef = db.collection('subscribers').doc(subscriberId).collection('quotes');
    const snapshot = await quotesRef
      .where('assignedCleaner', '==', cleanerName)
      .where('bookedDate', '!=', null)
      .get();

    const nextWeekStart = new Date();
    const nextWeekEnd = new Date(nextWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const jobs = snapshot.docs
      .map(doc => {
        const date = new Date(doc.data().bookedDate);
        return { customer: doc.data().customerName, date };
      })
      .filter(job => job.date >= nextWeekStart && job.date <= nextWeekEnd);

    return {
      cleaner: cleanerName,
      jobCount: jobs.length,
      jobs: jobs.map(j => `${j.customer} on ${j.date.toLocaleDateString()}`)
    };
  } catch (error) {
    console.error('Failed to get cleaner workload:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fetch workload');
  }
});

/**
 * Get weather forecast
 * GET /weather-forecast?lat=xxx&lon=xxx&days=7
 */
exports.getWeatherForecast = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { lat, lon, days = 7 } = data;

  if (!lat || !lon) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing latitude/longitude');
  }

  try {
    // Use Open-Meteo (free, no auth needed) instead of OpenWeatherMap
    const response = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,precipitation_sum,temperature_2m_max&timezone=auto&forecast_days=${Math.min(days, 16)}`
    );

    const forecast = response.data.daily;
    const rainDays = [];

    for (let i = 0; i < forecast.time.length; i++) {
      const date = new Date(forecast.time[i]);
      const precip = forecast.precipitation_sum[i];
      const weatherCode = forecast.weather_code[i];

      // Weather code: 45-48 = foggy, 51-67 = drizzle/rain, 71-77 = snow, 80-82 = showers, 85-86 = showers, 95+ = thunderstorm
      const isRainy = precip > 1 || (weatherCode >= 51 && weatherCode <= 99);

      if (isRainy) {
        rainDays.push({
          date: date.toLocaleDateString('en-GB'),
          precipitation: precip,
          condition: getWeatherDescription(weatherCode)
        });
      }
    }

    return {
      location: `${lat}, ${lon}`,
      rainDays,
      summary: rainDays.length > 0 
        ? `${rainDays.length} rainy days next week`
        : 'No rain expected next week'
    };
  } catch (error) {
    console.error('Failed to get weather forecast:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fetch weather');
  }
});

function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Foggy with rime',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight showers',
    81: 'Moderate showers',
    82: 'Violent showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with hail'
  };
  return descriptions[code] || 'Unknown';
}
